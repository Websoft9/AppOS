package routes

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	monitormetrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
)

type telegrafLine struct {
	measurement string
	tags        map[string]string
	fields      map[string]telegrafFieldValue
	observedAt  time.Time
}

type telegrafFieldValue struct {
	floatValue float64
	stringValue string
	isNumber   bool
	isString   bool
}

type telegrafCounterState struct {
	observedAt time.Time
	value      float64
}

type telegrafProjectionCache struct {
	mu       sync.Mutex
	counters map[string]telegrafCounterState
}

type telegrafHostAggregate struct {
	observedAt time.Time
	rxBytesPerSecond float64
	txBytesPerSecond float64
}

type telegrafDiskAggregate struct {
	observedAt time.Time
	readBytesPerSecond float64
	writeBytesPerSecond float64
}

type telegrafContainerAggregate struct {
	observedAt time.Time
	rawLabels  map[string]string
	inValue    float64
	outValue   float64
}

var telegrafCanonicalProjectionCache = &telegrafProjectionCache{counters: map[string]telegrafCounterState{}}

func projectTelegrafMetricPoints(payload []byte, serverID string, receivedAt time.Time) ([]monitormetrics.MetricPoint, error) {
	lines, err := parseTelegrafLineProtocol(payload, receivedAt)
	if err != nil {
		return nil, err
	}
	points := make([]monitormetrics.MetricPoint, 0, len(lines)*2)
	hostNetworkAggregates := map[string]*telegrafHostAggregate{}
	hostDiskAggregates := map[string]*telegrafDiskAggregate{}
	containerNetworkAggregates := map[string]*telegrafContainerAggregate{}
	containerBlockAggregates := map[string]*telegrafContainerAggregate{}

	for _, line := range lines {
		observedAt := line.observedAt
		if observedAt.IsZero() {
			observedAt = receivedAt
		}
		switch strings.TrimSpace(line.measurement) {
		case "cpu":
			if strings.TrimSpace(line.tags["cpu"]) != "cpu-total" {
				continue
			}
			usageIdle, ok := line.numericField("usage_idle")
			if !ok {
				continue
			}
			points = append(points, newCanonicalServerMetricPoint("appos_host_cpu_usage", 100-usageIdle, serverID, observedAt))
		case "mem":
			if used, ok := line.numericField("used"); ok {
				points = append(points, newCanonicalServerMetricPoint("appos_host_memory_bytes", used, serverID, observedAt))
			}
			if available, ok := line.numericField("available"); ok {
				points = append(points, newCanonicalServerMetricPoint("appos_host_memory_available_bytes", available, serverID, observedAt))
			}
		case "disk":
			if strings.TrimSpace(line.tags["path"]) != "/" {
				continue
			}
			if used, ok := line.numericField("used"); ok {
				points = append(points, newCanonicalServerMetricPoint("appos_host_disk_usage_bytes", used, serverID, observedAt))
			}
			if free, ok := line.numericField("free"); ok {
				points = append(points, newCanonicalServerMetricPoint("appos_host_disk_free_bytes", free, serverID, observedAt))
			}
		case "diskio":
			device := strings.TrimSpace(firstNonEmptyLabel(line.tags, "name", "device"))
			if device == "" {
				continue
			}
			if readBytes, ok := line.numericField("read_bytes"); ok {
				if rate, ok := telegrafCanonicalProjectionCache.rate(counterCacheKey("host-disk", serverID, device, "read"), readBytes, observedAt); ok {
					aggregateTimedDiskValue(hostDiskAggregates, observedAt, rate, 0)
				}
			}
			if writeBytes, ok := line.numericField("write_bytes"); ok {
				if rate, ok := telegrafCanonicalProjectionCache.rate(counterCacheKey("host-disk", serverID, device, "write"), writeBytes, observedAt); ok {
					aggregateTimedDiskValue(hostDiskAggregates, observedAt, 0, rate)
				}
			}
		case "net":
			iface := strings.TrimSpace(line.tags["interface"])
			if iface == "" {
				continue
			}
			if recvBytes, ok := line.numericField("bytes_recv"); ok {
				if rate, ok := telegrafCanonicalProjectionCache.rate(counterCacheKey("host-net", serverID, iface, "recv"), recvBytes, observedAt); ok {
					points = append(points, newCanonicalServerMetricPointWithLabels("appos_host_network_rx_bytes_per_second", rate, serverID, observedAt, map[string]string{"network_interface": iface}))
					aggregateTimedHostValue(hostNetworkAggregates, observedAt, rate, 0)
				}
			}
			if sentBytes, ok := line.numericField("bytes_sent"); ok {
				if rate, ok := telegrafCanonicalProjectionCache.rate(counterCacheKey("host-net", serverID, iface, "sent"), sentBytes, observedAt); ok {
					points = append(points, newCanonicalServerMetricPointWithLabels("appos_host_network_tx_bytes_per_second", math.Abs(rate), serverID, observedAt, map[string]string{"network_interface": iface}))
					aggregateTimedHostValue(hostNetworkAggregates, observedAt, 0, math.Abs(rate))
				}
			}
		case "docker_container_cpu":
			if strings.TrimSpace(line.tags["cpu"]) != "cpu-total" {
				continue
			}
			usagePercent, ok := line.numericField("usage_percent")
			if !ok {
				continue
			}
			rawLabels := telegrafContainerRawLabels(line)
			if point, ok := newCanonicalContainerMetricPoint("appos_container_cpu_usage_percent", usagePercent, serverID, observedAt, rawLabels); ok {
				points = append(points, point)
			}
		case "docker_container_mem":
			rawLabels := telegrafContainerRawLabels(line)
			if usage, ok := line.numericField("usage"); ok {
				if point, ok := newCanonicalContainerMetricPoint("appos_container_memory_usage_bytes", usage, serverID, observedAt, rawLabels); ok {
					points = append(points, point)
				}
			}
			if limit, ok := line.numericField("limit"); ok {
				if point, ok := newCanonicalContainerMetricPoint("appos_container_memory_limit_bytes", limit, serverID, observedAt, rawLabels); ok {
					points = append(points, point)
				}
			}
		case "docker_container_net":
			rawLabels := telegrafContainerRawLabels(line)
			containerIdentity := resolveContainerMetricIdentity(rawLabels)
			if containerIdentity == "" {
				continue
			}
			network := strings.TrimSpace(line.tags["network"])
			if recvBytes, ok := line.numericField("rx_bytes"); ok {
				if rate, ok := telegrafCanonicalProjectionCache.rate(counterCacheKey("container-net", serverID, containerIdentity, network, "recv"), recvBytes, observedAt); ok {
					aggregateTimedContainerValue(containerNetworkAggregates, containerIdentity, observedAt, rawLabels, rate, 0)
				}
			}
			if sentBytes, ok := line.numericField("tx_bytes"); ok {
				if rate, ok := telegrafCanonicalProjectionCache.rate(counterCacheKey("container-net", serverID, containerIdentity, network, "sent"), sentBytes, observedAt); ok {
					aggregateTimedContainerValue(containerNetworkAggregates, containerIdentity, observedAt, rawLabels, 0, math.Abs(rate))
				}
			}
		case "docker_container_blkio":
			rawLabels := telegrafContainerRawLabels(line)
			containerIdentity := resolveContainerMetricIdentity(rawLabels)
			if containerIdentity == "" {
				continue
			}
			device := strings.TrimSpace(line.tags["device"])
			if readBytes, ok := line.numericField("io_service_bytes_recursive_read"); ok {
				if rate, ok := telegrafCanonicalProjectionCache.rate(counterCacheKey("container-blkio", serverID, containerIdentity, device, "read"), readBytes, observedAt); ok {
					aggregateTimedContainerValue(containerBlockAggregates, containerIdentity, observedAt, rawLabels, rate, 0)
				}
			}
			if writeBytes, ok := line.numericField("io_service_bytes_recursive_write"); ok {
				if rate, ok := telegrafCanonicalProjectionCache.rate(counterCacheKey("container-blkio", serverID, containerIdentity, device, "write"), writeBytes, observedAt); ok {
					aggregateTimedContainerValue(containerBlockAggregates, containerIdentity, observedAt, rawLabels, 0, math.Abs(rate))
				}
			}
		}
	}

	points = append(points, buildHostNetworkAggregatePoints(hostNetworkAggregates, serverID)...)
	points = append(points, buildHostDiskAggregatePoints(hostDiskAggregates, serverID)...)
	points = append(points, buildContainerAggregatePoints(containerNetworkAggregates, serverID, "appos_container_network_receive_bytes_per_second", "appos_container_network_transmit_bytes_per_second")...)
	points = append(points, buildContainerAggregatePoints(containerBlockAggregates, serverID, "appos_container_block_read_bytes_per_second", "appos_container_block_write_bytes_per_second")...)
	sort.SliceStable(points, func(left, right int) bool {
		if points[left].ObservedAt.Equal(points[right].ObservedAt) {
			return points[left].Series < points[right].Series
		}
		return points[left].ObservedAt.Before(points[right].ObservedAt)
	})
	return points, nil
}

func parseTelegrafLineProtocol(payload []byte, receivedAt time.Time) ([]telegrafLine, error) {
	rawLines := strings.Split(strings.ReplaceAll(string(payload), "\r\n", "\n"), "\n")
	lines := make([]telegrafLine, 0, len(rawLines))
	for _, rawLine := range rawLines {
		rawLine = strings.TrimSpace(rawLine)
		if rawLine == "" || strings.HasPrefix(rawLine, "#") {
			continue
		}
		line, err := parseTelegrafLine(strings.TrimSpace(rawLine), receivedAt)
		if err != nil {
			return nil, err
		}
		lines = append(lines, line)
	}
	return lines, nil
}

func parseTelegrafLine(rawLine string, receivedAt time.Time) (telegrafLine, error) {
	seriesPart, fieldsPart, timestampPart, err := splitLineProtocolSections(rawLine)
	if err != nil {
		return telegrafLine{}, err
	}
	measurement, tags, err := parseLineProtocolSeriesPart(seriesPart)
	if err != nil {
		return telegrafLine{}, err
	}
	fields, err := parseLineProtocolFields(fieldsPart)
	if err != nil {
		return telegrafLine{}, err
	}
	observedAt := receivedAt
	if parsed, ok := parseLineProtocolTimestamp(timestampPart); ok {
		observedAt = parsed
	}
	return telegrafLine{measurement: measurement, tags: tags, fields: fields, observedAt: observedAt.UTC()}, nil
}

func splitLineProtocolSections(raw string) (string, string, string, error) {
	firstSpace := findLineProtocolSpace(raw, 0)
	if firstSpace < 0 {
		return "", "", "", fmt.Errorf("invalid telegraf line protocol line: %q", raw)
	}
	secondSpace := findLineProtocolSpace(raw, firstSpace+1)
	seriesPart := raw[:firstSpace]
	fieldsPart := ""
	timestampPart := ""
	if secondSpace < 0 {
		fieldsPart = raw[firstSpace+1:]
	} else {
		fieldsPart = raw[firstSpace+1 : secondSpace]
		timestampPart = raw[secondSpace+1:]
	}
	if strings.TrimSpace(seriesPart) == "" || strings.TrimSpace(fieldsPart) == "" {
		return "", "", "", fmt.Errorf("invalid telegraf line protocol line: %q", raw)
	}
	return seriesPart, fieldsPart, strings.TrimSpace(timestampPart), nil
}

func findLineProtocolSpace(raw string, start int) int {
	inQuotes := false
	escaped := false
	for index, r := range raw {
		if index < start {
			continue
		}
		switch {
		case escaped:
			escaped = false
		case r == '\\':
			escaped = true
		case r == '"':
			inQuotes = !inQuotes
		case r == ' ' && !inQuotes:
			return index
		}
	}
	return -1
}

func parseLineProtocolSeriesPart(raw string) (string, map[string]string, error) {
	segments := splitLineProtocolCSV(raw)
	if len(segments) == 0 {
		return "", nil, fmt.Errorf("missing line protocol measurement")
	}
	measurement := unescapeLineProtocolToken(segments[0])
	if strings.TrimSpace(measurement) == "" {
		return "", nil, fmt.Errorf("empty line protocol measurement")
	}
	tags := make(map[string]string, max(0, len(segments)-1))
	for _, segment := range segments[1:] {
		key, value, ok := splitLineProtocolKeyValue(segment)
		if !ok {
			continue
		}
		key = unescapeLineProtocolToken(key)
		value = unescapeLineProtocolToken(value)
		if strings.TrimSpace(key) == "" {
			continue
		}
		tags[key] = value
	}
	return measurement, tags, nil
}

func parseLineProtocolFields(raw string) (map[string]telegrafFieldValue, error) {
	segments := splitLineProtocolFieldsCSV(raw)
	fields := make(map[string]telegrafFieldValue, len(segments))
	for _, segment := range segments {
		key, value, ok := splitLineProtocolKeyValue(segment)
		if !ok {
			continue
		}
		field, ok := parseLineProtocolFieldValue(value)
		if !ok {
			continue
		}
		fields[unescapeLineProtocolToken(key)] = field
	}
	if len(fields) == 0 {
		return nil, fmt.Errorf("line protocol fields are empty")
	}
	return fields, nil
}

func parseLineProtocolFieldValue(raw string) (telegrafFieldValue, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return telegrafFieldValue{}, false
	}
	if strings.HasPrefix(raw, `"`) && strings.HasSuffix(raw, `"`) && len(raw) >= 2 {
		return telegrafFieldValue{stringValue: unescapeQuotedLineProtocolString(raw[1 : len(raw)-1]), isString: true}, true
	}
	trimmed := strings.TrimSuffix(strings.TrimSuffix(raw, "i"), "u")
	value, err := strconv.ParseFloat(trimmed, 64)
	if err == nil {
		return telegrafFieldValue{floatValue: value, isNumber: true}, true
	}
	return telegrafFieldValue{}, false
}

func parseLineProtocolTimestamp(raw string) (time.Time, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}, false
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return time.Time{}, false
	}
	digits := len(strings.TrimPrefix(raw, "-"))
	switch {
	case digits <= 10:
		return time.Unix(value, 0).UTC(), true
	case digits <= 13:
		return time.UnixMilli(value).UTC(), true
	case digits <= 16:
		return time.UnixMicro(value).UTC(), true
	default:
		return time.Unix(0, value).UTC(), true
	}
}

func splitLineProtocolCSV(raw string) []string {
	segments := make([]string, 0, 4)
	var builder strings.Builder
	escaped := false
	for _, r := range raw {
		switch {
		case escaped:
			builder.WriteRune(r)
			escaped = false
		case r == '\\':
			builder.WriteRune(r)
			escaped = true
		case r == ',':
			segments = append(segments, builder.String())
			builder.Reset()
		default:
			builder.WriteRune(r)
		}
	}
	segments = append(segments, builder.String())
	return segments
}

func splitLineProtocolFieldsCSV(raw string) []string {
	segments := make([]string, 0, 4)
	var builder strings.Builder
	inQuotes := false
	escaped := false
	for _, r := range raw {
		switch {
		case escaped:
			builder.WriteRune(r)
			escaped = false
		case r == '\\':
			builder.WriteRune(r)
			escaped = true
		case r == '"':
			builder.WriteRune(r)
			inQuotes = !inQuotes
		case r == ',' && !inQuotes:
			segments = append(segments, builder.String())
			builder.Reset()
		default:
			builder.WriteRune(r)
		}
	}
	segments = append(segments, builder.String())
	return segments
}

func splitLineProtocolKeyValue(raw string) (string, string, bool) {
	index := -1
	escaped := false
	for i, r := range raw {
		switch {
		case escaped:
			escaped = false
		case r == '\\':
			escaped = true
		case r == '=':
			index = i
			goto done
		}
	}
done:
	if index <= 0 || index >= len(raw)-1 {
		return "", "", false
	}
	return raw[:index], raw[index+1:], true
}

func unescapeLineProtocolToken(raw string) string {
	replacer := strings.NewReplacer(`\ `, ` `, `\,`, `,`, `\=`, `=`, `\\`, `\`)
	return replacer.Replace(strings.TrimSpace(raw))
}

func unescapeQuotedLineProtocolString(raw string) string {
	replacer := strings.NewReplacer(`\"`, `"`, `\\`, `\`)
	return replacer.Replace(raw)
}

func (line telegrafLine) numericField(key string) (float64, bool) {
	field, ok := line.fields[strings.TrimSpace(key)]
	if !ok || !field.isNumber {
		return 0, false
	}
	return field.floatValue, true
}

func (line telegrafLine) stringField(key string) string {
	field, ok := line.fields[strings.TrimSpace(key)]
	if !ok || !field.isString {
		return ""
	}
	return strings.TrimSpace(field.stringValue)
}

func (c *telegrafProjectionCache) rate(key string, currentValue float64, observedAt time.Time) (float64, bool) {
	if strings.TrimSpace(key) == "" || observedAt.IsZero() {
		return 0, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	previous, ok := c.counters[key]
	c.counters[key] = telegrafCounterState{observedAt: observedAt, value: currentValue}
	if !ok || !observedAt.After(previous.observedAt) || currentValue < previous.value {
		return 0, false
	}
	elapsedSeconds := observedAt.Sub(previous.observedAt).Seconds()
	if elapsedSeconds <= 0 {
		return 0, false
	}
	return (currentValue - previous.value) / elapsedSeconds, true
}

func (c *telegrafProjectionCache) reset() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.counters = map[string]telegrafCounterState{}
}

func counterCacheKey(parts ...string) string {
	normalized := make([]string, 0, len(parts))
	for _, part := range parts {
		normalized = append(normalized, strings.TrimSpace(part))
	}
	return strings.Join(normalized, "\x00")
}

func aggregateTimedHostValue(accumulators map[string]*telegrafHostAggregate, observedAt time.Time, rxValue, txValue float64) {
	key := observedAt.Format(time.RFC3339Nano)
	accumulator := accumulators[key]
	if accumulator == nil {
		accumulator = &telegrafHostAggregate{observedAt: observedAt}
		accumulators[key] = accumulator
	}
	accumulator.rxBytesPerSecond += rxValue
	accumulator.txBytesPerSecond += txValue
}

func aggregateTimedDiskValue(accumulators map[string]*telegrafDiskAggregate, observedAt time.Time, readValue, writeValue float64) {
	key := observedAt.Format(time.RFC3339Nano)
	accumulator := accumulators[key]
	if accumulator == nil {
		accumulator = &telegrafDiskAggregate{observedAt: observedAt}
		accumulators[key] = accumulator
	}
	accumulator.readBytesPerSecond += readValue
	accumulator.writeBytesPerSecond += writeValue
}

func aggregateTimedContainerValue(accumulators map[string]*telegrafContainerAggregate, containerIdentity string, observedAt time.Time, rawLabels map[string]string, inValue, outValue float64) {
	key := containerIdentity + "\x00" + observedAt.Format(time.RFC3339Nano)
	accumulator := accumulators[key]
	if accumulator == nil {
		copiedLabels := make(map[string]string, len(rawLabels))
		for labelKey, labelValue := range rawLabels {
			copiedLabels[labelKey] = labelValue
		}
		accumulator = &telegrafContainerAggregate{observedAt: observedAt, rawLabels: copiedLabels}
		accumulators[key] = accumulator
	}
	accumulator.inValue += inValue
	accumulator.outValue += outValue
}

func buildHostNetworkAggregatePoints(accumulators map[string]*telegrafHostAggregate, serverID string) []monitormetrics.MetricPoint {
	points := make([]monitormetrics.MetricPoint, 0, len(accumulators)*2)
	for _, accumulator := range accumulators {
		points = append(points,
			newCanonicalServerMetricPointWithLabels("appos_host_network_rx_bytes_per_second", accumulator.rxBytesPerSecond, serverID, accumulator.observedAt, map[string]string{"network_interface": ""}),
			newCanonicalServerMetricPointWithLabels("appos_host_network_tx_bytes_per_second", accumulator.txBytesPerSecond, serverID, accumulator.observedAt, map[string]string{"network_interface": ""}),
		)
	}
	return points
}

func buildHostDiskAggregatePoints(accumulators map[string]*telegrafDiskAggregate, serverID string) []monitormetrics.MetricPoint {
	points := make([]monitormetrics.MetricPoint, 0, len(accumulators)*2)
	for _, accumulator := range accumulators {
		points = append(points,
			newCanonicalServerMetricPoint("appos_host_disk_read_bytes_per_second", accumulator.readBytesPerSecond, serverID, accumulator.observedAt),
			newCanonicalServerMetricPoint("appos_host_disk_write_bytes_per_second", accumulator.writeBytesPerSecond, serverID, accumulator.observedAt),
		)
	}
	return points
}

func buildContainerAggregatePoints(accumulators map[string]*telegrafContainerAggregate, serverID string, inSeries string, outSeries string) []monitormetrics.MetricPoint {
	points := make([]monitormetrics.MetricPoint, 0, len(accumulators)*2)
	for _, accumulator := range accumulators {
		if point, ok := newCanonicalContainerMetricPoint(inSeries, accumulator.inValue, serverID, accumulator.observedAt, accumulator.rawLabels); ok {
			points = append(points, point)
		}
		if point, ok := newCanonicalContainerMetricPoint(outSeries, accumulator.outValue, serverID, accumulator.observedAt, accumulator.rawLabels); ok {
			points = append(points, point)
		}
	}
	return points
}

func telegrafContainerRawLabels(line telegrafLine) map[string]string {
	labels := make(map[string]string, len(line.tags)+4)
	for key, value := range line.tags {
		labels[key] = value
	}
	if containerID := strings.TrimSpace(firstNonEmptyLabel(labels, "container_id")); containerID == "" {
		if containerID = strings.TrimSpace(line.stringField("container_id")); containerID != "" {
			labels["container_id"] = containerID
		}
	}
	if containerName := strings.TrimSpace(firstNonEmptyLabel(labels, "container_name", "name")); containerName == "" {
		if containerName = strings.TrimSpace(line.stringField("container_name")); containerName != "" {
			labels["container_name"] = containerName
		}
	}
	if composeProject := strings.TrimSpace(firstNonEmptyLabel(labels, "compose_project", "com_docker_compose_project", "com.docker.compose.project")); composeProject != "" {
		labels["compose_project"] = composeProject
	}
	if composeService := strings.TrimSpace(firstNonEmptyLabel(labels, "compose_service", "com_docker_compose_service", "com.docker.compose.service")); composeService != "" {
		labels["compose_service"] = composeService
	}
	return labels
}