package routes

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/gogo/protobuf/proto"
	"github.com/golang/snappy"
	monitormetrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
	"github.com/prometheus/prometheus/prompb"
)

const (
	mibToBytes = 1024 * 1024
	gibToBytes = 1024 * 1024 * 1024
)

func projectRemoteWriteMetricPoints(payload []byte, contentEncoding string, serverID string) ([]monitormetrics.MetricPoint, error) {
	decoded, err := decodeRemoteWritePayload(payload, contentEncoding)
	if err != nil {
		return nil, err
	}
	request := &prompb.WriteRequest{}
	if err := proto.Unmarshal(decoded, request); err != nil {
		return nil, err
	}
	points := make([]monitormetrics.MetricPoint, 0, len(request.Timeseries))
	for _, series := range request.Timeseries {
		points = append(points, normalizeRemoteWriteSeries(series, serverID)...)
	}
	points = append(points, deriveHostMemoryAvailablePoints(request.Timeseries, serverID)...)
	points = append(points, deriveHostDiskFreePoints(request.Timeseries, serverID)...)
	points = append(points, deriveHostDiskRatePoints(request.Timeseries, serverID)...)
	points = append(points, deriveHostNetworkRatePoints(request.Timeseries, serverID)...)
	points = append(points, deriveContainerMemoryLimitPoints(request.Timeseries, serverID)...)
	points = append(points, deriveContainerNetworkRatePoints(request.Timeseries, serverID)...)
	if warning := diagnoseDroppedContainerSeries(request.Timeseries, serverID); warning != nil {
		return points, warning
	}
	return points, nil
}

type droppedContainerSeriesSummary struct {
	metricNames []string
	missingID   int
}

func diagnoseDroppedContainerSeries(timeseries []prompb.TimeSeries, serverID string) error {
	summary := droppedContainerSeriesSummary{}
	seenMetricNames := map[string]struct{}{}
	for _, series := range timeseries {
		labels := make(map[string]string, len(series.Labels))
		for _, label := range series.Labels {
			name := strings.TrimSpace(label.Name)
			if name == "" {
				continue
			}
			labels[name] = strings.TrimSpace(label.Value)
		}
		metricName := labels["__name__"]
		if !isContainerCgroupMetric(metricName) {
			continue
		}
		instance := labels["instance"]
		if instance != "" && instance != serverID {
			continue
		}
		if resolveContainerMetricIdentity(labels) != "" {
			continue
		}
		summary.missingID++
		if _, ok := seenMetricNames[metricName]; ok {
			continue
		}
		seenMetricNames[metricName] = struct{}{}
		summary.metricNames = append(summary.metricNames, metricName)
	}
	if summary.missingID == 0 {
		return nil
	}
	sort.Strings(summary.metricNames)
	return fmt.Errorf("dropped %d container cgroup series without stable container identity labels; metric families=%s", summary.missingID, strings.Join(summary.metricNames, ","))
}

func isContainerCgroupMetric(metricName string) bool {
	switch strings.TrimSpace(metricName) {
	case "netdata_cgroup_cpu_limit_percentage_average",
		"netdata_cgroup_mem_usage_MiB_average",
		"netdata_cgroup_mem_usage_limit_MiB_average",
		"netdata_cgroup_io_KiB_persec_average",
		"netdata_cgroup_net_net_kilobits_persec_average":
		return true
	default:
		return false
	}
}

type hostMemoryAvailableAccumulator struct {
	serverID       string
	observedAt     time.Time
	availableBytes float64
	hasSamples     bool
}

type hostDiskFreeAccumulator struct {
	serverID   string
	observedAt time.Time
	freeBytes  float64
	hasSamples bool
}

type hostRateAccumulator struct {
	serverID   string
	observedAt time.Time
	series     string
	value      float64
	labels     map[string]string
	hasSamples bool
}

type containerMemoryLimitAccumulator struct {
	serverID       string
	observedAt     time.Time
	rawLabels      map[string]string
	usedBytes      float64
	hasUsed        bool
	availableBytes float64
	hasAvailable   bool
}

type containerRateAccumulator struct {
	serverID   string
	observedAt time.Time
	rawLabels  map[string]string
	series     string
	value      float64
	hasSamples bool
}

func decodeRemoteWritePayload(payload []byte, contentEncoding string) ([]byte, error) {
	if !strings.Contains(strings.ToLower(strings.TrimSpace(contentEncoding)), "snappy") {
		return payload, nil
	}
	decoded, err := snappy.Decode(nil, payload)
	if err != nil {
		return nil, err
	}
	return decoded, nil
}

func normalizeRemoteWriteSeries(series prompb.TimeSeries, serverID string) []monitormetrics.MetricPoint {
	labels := make(map[string]string, len(series.Labels))
	for _, label := range series.Labels {
		name := strings.TrimSpace(label.Name)
		if name == "" {
			continue
		}
		labels[name] = strings.TrimSpace(label.Value)
	}
	metricName := labels["__name__"]
	instance := labels["instance"]
	if instance != "" && instance != serverID {
		return nil
	}
	points := make([]monitormetrics.MetricPoint, 0, len(series.Samples))
	for _, sample := range series.Samples {
		observedAt := time.UnixMilli(sample.Timestamp).UTC()
		if observedAt.IsZero() {
			continue
		}
		switch metricName {
		case "netdata_system_cpu_percentage_average":
			if labels["dimension"] != "idle" {
				continue
			}
			points = append(points, newCanonicalServerMetricPoint("appos_host_cpu_usage", 100-sample.Value, serverID, observedAt))
		case "netdata_system_ram_MiB_average":
			if labels["dimension"] != "used" {
				continue
			}
			points = append(points, newCanonicalServerMetricPoint("appos_host_memory_bytes", sample.Value*mibToBytes, serverID, observedAt))
		case "netdata_disk_space_GiB_average":
			if labels["family"] != "/" || labels["dimension"] != "used" {
				continue
			}
			points = append(points, newCanonicalServerMetricPoint("appos_host_disk_usage_bytes", sample.Value*gibToBytes, serverID, observedAt))
		case "netdata_system_net_kilobits_persec_average":
			continue
		case "netdata_system_io_KiB_persec_average":
			continue
		case "netdata_cgroup_cpu_limit_percentage_average":
			if labels["dimension"] != "used" {
				continue
			}
			if point, ok := newCanonicalContainerMetricPoint("appos_container_cpu_usage_percent", sample.Value, serverID, observedAt, labels); ok {
				points = append(points, point)
			}
		case "netdata_cgroup_mem_usage_MiB_average":
			if labels["dimension"] != "ram" {
				continue
			}
			if point, ok := newCanonicalContainerMetricPoint("appos_container_memory_usage_bytes", sample.Value*mibToBytes, serverID, observedAt, labels); ok {
				points = append(points, point)
			}
		case "netdata_cgroup_io_KiB_persec_average":
			value := sample.Value * 1024
			if value < 0 {
				value = -value
			}
			switch labels["dimension"] {
			case "read":
				if point, ok := newCanonicalContainerMetricPoint("appos_container_block_read_bytes_per_second", value, serverID, observedAt, labels); ok {
					points = append(points, point)
				}
			case "write":
				if point, ok := newCanonicalContainerMetricPoint("appos_container_block_write_bytes_per_second", value, serverID, observedAt, labels); ok {
					points = append(points, point)
				}
			}
		}
	}
	return points
}

func deriveHostMemoryAvailablePoints(timeseries []prompb.TimeSeries, serverID string) []monitormetrics.MetricPoint {
	accumulators := make(map[string]*hostMemoryAvailableAccumulator)
	for _, series := range timeseries {
		labels := make(map[string]string, len(series.Labels))
		for _, label := range series.Labels {
			name := strings.TrimSpace(label.Name)
			if name == "" {
				continue
			}
			labels[name] = strings.TrimSpace(label.Value)
		}
		if labels["__name__"] != "netdata_system_ram_MiB_average" {
			continue
		}
		instance := labels["instance"]
		if instance != "" && instance != serverID {
			continue
		}
		dimension := labels["dimension"]
		if dimension != "free" && dimension != "cached" && dimension != "buffers" {
			continue
		}
		for _, sample := range series.Samples {
			observedAt := time.UnixMilli(sample.Timestamp).UTC()
			if observedAt.IsZero() {
				continue
			}
			key := observedAt.Format(time.RFC3339Nano)
			accumulator := accumulators[key]
			if accumulator == nil {
				accumulator = &hostMemoryAvailableAccumulator{serverID: serverID, observedAt: observedAt}
				accumulators[key] = accumulator
			}
			accumulator.availableBytes += sample.Value * mibToBytes
			accumulator.hasSamples = true
		}
	}
	points := make([]monitormetrics.MetricPoint, 0, len(accumulators))
	for _, accumulator := range accumulators {
		if !accumulator.hasSamples {
			continue
		}
		points = append(points, newCanonicalServerMetricPoint("appos_host_memory_available_bytes", accumulator.availableBytes, accumulator.serverID, accumulator.observedAt))
	}
	return points
}

func deriveHostDiskFreePoints(timeseries []prompb.TimeSeries, serverID string) []monitormetrics.MetricPoint {
	accumulators := make(map[string]*hostDiskFreeAccumulator)
	for _, series := range timeseries {
		labels := make(map[string]string, len(series.Labels))
		for _, label := range series.Labels {
			name := strings.TrimSpace(label.Name)
			if name == "" {
				continue
			}
			labels[name] = strings.TrimSpace(label.Value)
		}
		if labels["__name__"] != "netdata_disk_space_GiB_average" {
			continue
		}
		instance := labels["instance"]
		if instance != "" && instance != serverID {
			continue
		}
		if labels["family"] != "/" {
			continue
		}
		dimension := labels["dimension"]
		if dimension != "avail" && dimension != "reserved_for_root" {
			continue
		}
		for _, sample := range series.Samples {
			observedAt := time.UnixMilli(sample.Timestamp).UTC()
			if observedAt.IsZero() {
				continue
			}
			key := observedAt.Format(time.RFC3339Nano)
			accumulator := accumulators[key]
			if accumulator == nil {
				accumulator = &hostDiskFreeAccumulator{serverID: serverID, observedAt: observedAt}
				accumulators[key] = accumulator
			}
			accumulator.freeBytes += sample.Value * gibToBytes
			accumulator.hasSamples = true
		}
	}
	points := make([]monitormetrics.MetricPoint, 0, len(accumulators))
	for _, accumulator := range accumulators {
		if !accumulator.hasSamples {
			continue
		}
		points = append(points, newCanonicalServerMetricPoint("appos_host_disk_free_bytes", accumulator.freeBytes, accumulator.serverID, accumulator.observedAt))
	}
	return points
}

func deriveHostDiskRatePoints(timeseries []prompb.TimeSeries, serverID string) []monitormetrics.MetricPoint {
	accumulators := make(map[string]*hostRateAccumulator)
	for _, series := range timeseries {
		labels := make(map[string]string, len(series.Labels))
		for _, label := range series.Labels {
			name := strings.TrimSpace(label.Name)
			if name == "" {
				continue
			}
			labels[name] = strings.TrimSpace(label.Value)
		}
		if labels["__name__"] != "netdata_system_io_KiB_persec_average" {
			continue
		}
		instance := labels["instance"]
		if instance != "" && instance != serverID {
			continue
		}
		var canonicalSeries string
		switch labels["dimension"] {
		case "reads":
			canonicalSeries = "appos_host_disk_read_bytes_per_second"
		case "writes":
			canonicalSeries = "appos_host_disk_write_bytes_per_second"
		default:
			continue
		}
		for _, sample := range series.Samples {
			observedAt := time.UnixMilli(sample.Timestamp).UTC()
			if observedAt.IsZero() {
				continue
			}
			key := canonicalSeries + "\x00" + observedAt.Format(time.RFC3339Nano)
			accumulator := accumulators[key]
			if accumulator == nil {
				accumulator = &hostRateAccumulator{serverID: serverID, observedAt: observedAt, series: canonicalSeries}
				accumulators[key] = accumulator
			}
			accumulator.value += sample.Value * 1024
			accumulator.hasSamples = true
		}
	}
	points := make([]monitormetrics.MetricPoint, 0, len(accumulators))
	for _, accumulator := range accumulators {
		if !accumulator.hasSamples {
			continue
		}
		points = append(points, newCanonicalServerMetricPoint(accumulator.series, accumulator.value, accumulator.serverID, accumulator.observedAt))
	}
	return points
}

func deriveHostNetworkRatePoints(timeseries []prompb.TimeSeries, serverID string) []monitormetrics.MetricPoint {
	accumulators := make(map[string]*hostRateAccumulator)
	for _, series := range timeseries {
		labels := make(map[string]string, len(series.Labels))
		for _, label := range series.Labels {
			name := strings.TrimSpace(label.Name)
			if name == "" {
				continue
			}
			labels[name] = strings.TrimSpace(label.Value)
		}
		metricName := labels["__name__"]
		if metricName != "netdata_system_net_kilobits_persec_average" && metricName != "netdata_net_net_kilobits_persec_average" {
			continue
		}
		instance := labels["instance"]
		if instance != "" && instance != serverID {
			continue
		}
		var canonicalSeries string
		switch labels["dimension"] {
		case "received":
			canonicalSeries = "appos_host_network_rx_bytes_per_second"
		case "sent":
			canonicalSeries = "appos_host_network_tx_bytes_per_second"
		default:
			continue
		}
		interfaceName := ""
		if metricName == "netdata_net_net_kilobits_persec_average" {
			interfaceName = strings.TrimSpace(labels["device"])
		}
		for _, sample := range series.Samples {
			observedAt := time.UnixMilli(sample.Timestamp).UTC()
			if observedAt.IsZero() {
				continue
			}
			key := canonicalSeries + "\x00" + interfaceName + "\x00" + observedAt.Format(time.RFC3339Nano)
			accumulator := accumulators[key]
			if accumulator == nil {
				accumulator = &hostRateAccumulator{serverID: serverID, observedAt: observedAt, series: canonicalSeries, labels: map[string]string{}}
				if interfaceName != "" {
					accumulator.labels["network_interface"] = interfaceName
				}
				accumulators[key] = accumulator
			}
			accumulator.value += math.Abs(sample.Value) * 125
			accumulator.hasSamples = true
		}
	}
	points := make([]monitormetrics.MetricPoint, 0, len(accumulators))
	for _, accumulator := range accumulators {
		if !accumulator.hasSamples {
			continue
		}
		points = append(points, newCanonicalServerMetricPointWithLabels(accumulator.series, accumulator.value, accumulator.serverID, accumulator.observedAt, accumulator.labels))
	}
	return points
}

func deriveContainerNetworkRatePoints(timeseries []prompb.TimeSeries, serverID string) []monitormetrics.MetricPoint {
	accumulators := make(map[string]*containerRateAccumulator)
	for _, series := range timeseries {
		labels := make(map[string]string, len(series.Labels))
		for _, label := range series.Labels {
			name := strings.TrimSpace(label.Name)
			if name == "" {
				continue
			}
			labels[name] = strings.TrimSpace(label.Value)
		}
		if labels["__name__"] != "netdata_cgroup_net_net_kilobits_persec_average" {
			continue
		}
		instance := labels["instance"]
		if instance != "" && instance != serverID {
			continue
		}
		containerIdentity := resolveContainerMetricIdentity(labels)
		if containerIdentity == "" {
			continue
		}
		var canonicalSeries string
		switch labels["dimension"] {
		case "received":
			canonicalSeries = "appos_container_network_receive_bytes_per_second"
		case "sent":
			canonicalSeries = "appos_container_network_transmit_bytes_per_second"
		default:
			continue
		}
		for _, sample := range series.Samples {
			observedAt := time.UnixMilli(sample.Timestamp).UTC()
			if observedAt.IsZero() {
				continue
			}
			value := sample.Value * 125
			if value < 0 {
				value = -value
			}
			key := canonicalSeries + "\x00" + containerIdentity + "\x00" + observedAt.Format(time.RFC3339Nano)
			accumulator := accumulators[key]
			if accumulator == nil {
				accumulator = &containerRateAccumulator{
					serverID:   serverID,
					observedAt: observedAt,
					rawLabels:  labels,
					series:     canonicalSeries,
				}
				accumulators[key] = accumulator
			}
			accumulator.value += value
			accumulator.hasSamples = true
		}
	}
	points := make([]monitormetrics.MetricPoint, 0, len(accumulators))
	for _, accumulator := range accumulators {
		if !accumulator.hasSamples {
			continue
		}
		point, ok := newCanonicalContainerMetricPoint(accumulator.series, accumulator.value, accumulator.serverID, accumulator.observedAt, accumulator.rawLabels)
		if !ok {
			continue
		}
		points = append(points, point)
	}
	return points
}

func deriveContainerMemoryLimitPoints(timeseries []prompb.TimeSeries, serverID string) []monitormetrics.MetricPoint {
	accumulators := make(map[string]*containerMemoryLimitAccumulator)
	for _, series := range timeseries {
		labels := make(map[string]string, len(series.Labels))
		for _, label := range series.Labels {
			name := strings.TrimSpace(label.Name)
			if name == "" {
				continue
			}
			labels[name] = strings.TrimSpace(label.Value)
		}
		if labels["__name__"] != "netdata_cgroup_mem_usage_limit_MiB_average" {
			continue
		}
		instance := labels["instance"]
		if instance != "" && instance != serverID {
			continue
		}
		containerIdentity := resolveContainerMetricIdentity(labels)
		if containerIdentity == "" {
			continue
		}
		dimension := labels["dimension"]
		if dimension != "used" && dimension != "available" {
			continue
		}
		for _, sample := range series.Samples {
			observedAt := time.UnixMilli(sample.Timestamp).UTC()
			if observedAt.IsZero() {
				continue
			}
			key := containerIdentity + "\x00" + observedAt.Format(time.RFC3339Nano)
			accumulator := accumulators[key]
			if accumulator == nil {
				accumulator = &containerMemoryLimitAccumulator{
					serverID:   serverID,
					observedAt: observedAt,
					rawLabels:  labels,
				}
				accumulators[key] = accumulator
			}
			if dimension == "used" {
				accumulator.usedBytes = sample.Value * mibToBytes
				accumulator.hasUsed = true
				continue
			}
			accumulator.availableBytes = sample.Value * mibToBytes
			accumulator.hasAvailable = true
		}
	}
	points := make([]monitormetrics.MetricPoint, 0, len(accumulators))
	for _, accumulator := range accumulators {
		if !accumulator.hasUsed || !accumulator.hasAvailable {
			continue
		}
		point, ok := newCanonicalContainerMetricPoint(
			"appos_container_memory_limit_bytes",
			accumulator.usedBytes+accumulator.availableBytes,
			accumulator.serverID,
			accumulator.observedAt,
			accumulator.rawLabels,
		)
		if !ok {
			continue
		}
		points = append(points, point)
	}
	return points
}

func newCanonicalServerMetricPoint(series string, value float64, serverID string, observedAt time.Time) monitormetrics.MetricPoint {
	return newCanonicalServerMetricPointWithLabels(series, value, serverID, observedAt, nil)
}

func newCanonicalServerMetricPointWithLabels(series string, value float64, serverID string, observedAt time.Time, extraLabels map[string]string) monitormetrics.MetricPoint {
	labels := map[string]string{
		"server_id":   serverID,
		"target_type": "server",
		"target_id":   serverID,
	}
	for key, value := range extraLabels {
		if strings.TrimSpace(key) == "" || strings.TrimSpace(value) == "" {
			continue
		}
		labels[key] = value
	}
	return monitormetrics.MetricPoint{
		Series: series,
		Value:  value,
		Labels: labels,
		ObservedAt: observedAt,
	}
}

func newCanonicalContainerMetricPoint(series string, value float64, serverID string, observedAt time.Time, rawLabels map[string]string) (monitormetrics.MetricPoint, bool) {
	containerID := resolveContainerMetricIdentity(rawLabels)
	if containerID == "" {
		return monitormetrics.MetricPoint{}, false
	}
	labels := map[string]string{
		"server_id":   serverID,
		"target_type": "container",
		"target_id":   containerID,
		"container_id": containerID,
	}
	if containerName := normalizeContainerMetricName(firstNonEmptyLabel(rawLabels, "container_name", "name", "cgroup_name")); containerName != "" {
		labels["container_name"] = containerName
	} else {
		labels["container_name"] = containerID
	}
	if composeProject := strings.TrimSpace(firstNonEmptyLabel(rawLabels, "compose_project", "compose_project_name")); composeProject != "" {
		labels["compose_project"] = composeProject
	}
	if composeService := strings.TrimSpace(firstNonEmptyLabel(rawLabels, "compose_service", "compose_service_name")); composeService != "" {
		labels["compose_service"] = composeService
	}
	return monitormetrics.MetricPoint{
		Series:     series,
		Value:      value,
		Labels:     labels,
		ObservedAt: observedAt,
	}, true
}

func resolveContainerMetricIdentity(labels map[string]string) string {
	if containerName := normalizeContainerMetricName(firstNonEmptyLabel(labels, "container_name", "name", "cgroup_name")); containerName != "" {
		return containerName
	}
	if chartIdentity := containerIdentityFromNetdataChart(firstNonEmptyLabel(labels, "chart", "type")); chartIdentity != "" {
		return chartIdentity
	}
	return strings.TrimSpace(firstNonEmptyLabel(labels, "container_id", "containerId", "docker_id", "id"))
}

func containerIdentityFromNetdataChart(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = strings.TrimPrefix(value, "cgroup_")
	if value == "" {
		return ""
	}
	if suffixIndex := strings.IndexByte(value, '.'); suffixIndex >= 0 {
		value = value[:suffixIndex]
	}
	return normalizeContainerMetricName(value)
}

func normalizeContainerMetricName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = strings.Split(value, ",")[0]
	return strings.TrimSpace(strings.TrimPrefix(value, "/"))
}

func firstNonEmptyLabel(labels map[string]string, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(labels[key]); value != "" {
			return value
		}
	}
	return ""
}

func describeRemoteWriteProjectionError(err error) string {
	if err == nil {
		return ""
	}
	return fmt.Sprintf("remote write canonical projection skipped: %v", err)
}