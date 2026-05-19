package metrics

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	monitortsdb "github.com/websoft9/appos/backend/domain/monitor/metrics/tsdb"
)

type containerTelemetryQueryOverrideFunc func(context.Context, string, []ContainerTelemetryTarget, string) (*ContainerTelemetryResponse, error)

var (
	containerTelemetryQueryOverrideMu sync.RWMutex
	containerTelemetryQueryOverride   containerTelemetryQueryOverrideFunc
)

func SetContainerTelemetryQueryFuncForTest(fn containerTelemetryQueryOverrideFunc) func() {
	containerTelemetryQueryOverrideMu.Lock()
	previous := containerTelemetryQueryOverride
	containerTelemetryQueryOverride = fn
	containerTelemetryQueryOverrideMu.Unlock()
	return func() {
		containerTelemetryQueryOverrideMu.Lock()
		containerTelemetryQueryOverride = previous
		containerTelemetryQueryOverrideMu.Unlock()
	}
}

func QueryContainerTelemetry(ctx context.Context, serverID string, targets []ContainerTelemetryTarget, window string) (*ContainerTelemetryResponse, error) {
	serverID = strings.TrimSpace(serverID)
	window = strings.TrimSpace(window)
	if serverID == "" {
		return nil, fmt.Errorf("server id is required")
	}
	if window == "" {
		window = "15m"
	}
	containerTelemetryQueryOverrideMu.RLock()
	override := containerTelemetryQueryOverride
	containerTelemetryQueryOverrideMu.RUnlock()
	if override != nil {
		return override(ctx, serverID, targets, window)
	}
	return queryContainerTelemetryVM(ctx, serverID, targets, window)
}

func queryContainerTelemetryVM(ctx context.Context, serverID string, targets []ContainerTelemetryTarget, window string) (*ContainerTelemetryResponse, error) {
	windowSpec, err := resolveMetricSeriesWindow(window, MetricSeriesQueryOptions{}, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	requestedTargets := normalizeContainerTelemetryTargets(targets)
	response := &ContainerTelemetryResponse{
		ServerID:     serverID,
		Window:       windowSpec.Label,
		RangeStartAt: windowSpec.Start.Format(time.RFC3339),
		RangeEndAt:   windowSpec.End.Format(time.RFC3339),
		StepSeconds:  int(windowSpec.Step.Seconds()),
		Items:        make([]ContainerTelemetryItem, 0, max(1, len(requestedTargets))),
	}
	itemsByID := make(map[string]*ContainerTelemetryItem, len(requestedTargets))
	for _, target := range requestedTargets {
		item := &ContainerTelemetryItem{
			ContainerID:   target.ID,
			ContainerName: target.Name,
			Freshness:     ContainerTelemetryFreshness{State: "missing"},
		}
		itemsByID[target.ID] = item
	}
	baseURL := strings.TrimSpace(os.Getenv(EnvVictoriaMetricsURL))
	if baseURL == "" {
		response.Items = flattenContainerTelemetryItems(itemsByID)
		return response, nil
	}
	service := monitortsdb.NewService(metricsHTTPClient, baseURL)
	selector := buildContainerTelemetrySelector(serverID, containerTelemetryTargetIDs(requestedTargets))
	queries := []struct {
		name    string
		unit    string
		series  string
		segment string
	}{
		{name: "cpu", unit: "percent", series: "appos_container_cpu_usage_percent"},
		{name: "memory", unit: "bytes", series: "appos_container_memory_usage_bytes", segment: "usage"},
		{name: "memory", unit: "bytes", series: "appos_container_memory_limit_bytes", segment: "limit"},
		{name: "network", unit: "bytes/s", series: "appos_container_network_receive_bytes_per_second", segment: "in"},
		{name: "network", unit: "bytes/s", series: "appos_container_network_transmit_bytes_per_second", segment: "out"},
		{name: "block", unit: "bytes/s", series: "appos_container_block_read_bytes_per_second", segment: "read"},
		{name: "block", unit: "bytes/s", series: "appos_container_block_write_bytes_per_second", segment: "write"},
	}
	for _, query := range queries {
		matrix, err := service.ExecuteQueryRangeMatrix(
			ctx,
			fmt.Sprintf(`%s%s`, query.series, selector),
			windowSpec.Start,
			windowSpec.End,
			windowSpec.Step,
		)
		if err != nil {
			return nil, err
		}
		for _, series := range matrix {
			containerID := strings.TrimSpace(series.Metric["container_id"])
			if containerID == "" {
				continue
			}
			item := itemsByID[containerID]
			if item == nil {
				item = &ContainerTelemetryItem{
					ContainerID: containerID,
					Freshness:   ContainerTelemetryFreshness{State: "missing"},
				}
				itemsByID[containerID] = item
			}
			if item.ContainerName == "" {
				item.ContainerName = strings.TrimSpace(series.Metric["container_name"])
			}
			if item.ComposeProject == "" {
				item.ComposeProject = strings.TrimSpace(series.Metric["compose_project"])
			}
			if item.ComposeService == "" {
				item.ComposeService = strings.TrimSpace(series.Metric["compose_service"])
			}
			seriesPoints := cloneMetricPoints(series.Values)
			latestValue, observedAt, hasLatest := latestMetricPoint(seriesPoints)
			if hasLatest {
				switch query.series {
				case "appos_container_cpu_usage_percent":
					item.Latest.CPUPercent = &latestValue
				case "appos_container_memory_usage_bytes":
					item.Latest.MemoryUsageBytes = &latestValue
				case "appos_container_memory_limit_bytes":
					item.Latest.MemoryLimitBytes = &latestValue
				case "appos_container_network_receive_bytes_per_second":
					item.Latest.NetworkRxBytesPerSecond = &latestValue
				case "appos_container_network_transmit_bytes_per_second":
					item.Latest.NetworkTxBytesPerSecond = &latestValue
				case "appos_container_block_read_bytes_per_second":
					item.Latest.BlockReadBytesPerSecond = &latestValue
				case "appos_container_block_write_bytes_per_second":
					item.Latest.BlockWriteBytesPerSecond = &latestValue
				}
				mergeTelemetryFreshness(item, observedAt, windowSpec.End, windowSpec.Step)
			}
			appendContainerTelemetrySeries(item, MetricSeries{
				Name:     query.name,
				Unit:     query.unit,
				Points:   seriesPoints,
				Segments: nil,
			}, query.segment)
		}
	}
	if err := queryRawNetdataContainerTelemetry(ctx, service, serverID, requestedTargets, itemsByID, windowSpec.Start, windowSpec.End, windowSpec.Step); err != nil {
		return nil, err
	}
	response.Items = flattenContainerTelemetryItems(itemsByID)
	return response, nil
}

func normalizeContainerTelemetryTargets(values []ContainerTelemetryTarget) []ContainerTelemetryTarget {
	seen := map[string]struct{}{}
	normalized := make([]ContainerTelemetryTarget, 0, len(values))
	for _, value := range values {
		for _, idPart := range strings.Split(value.ID, ",") {
			idPart = strings.TrimSpace(idPart)
			if idPart == "" {
				continue
			}
			if _, ok := seen[idPart]; ok {
				continue
			}
			seen[idPart] = struct{}{}
			normalized = append(normalized, ContainerTelemetryTarget{ID: idPart, Name: normalizeContainerTelemetryName(value.Name)})
		}
	}
	sort.Slice(normalized, func(left, right int) bool {
		return normalized[left].ID < normalized[right].ID
	})
	return normalized
}

func containerTelemetryTargetIDs(targets []ContainerTelemetryTarget) []string {
	ids := make([]string, 0, len(targets))
	for _, target := range targets {
		ids = append(ids, target.ID)
	}
	return ids
}

func buildContainerTelemetrySelector(serverID string, containerIDs []string) string {
	selector := fmt.Sprintf(`{server_id=%q}`, serverID)
	if len(containerIDs) == 0 {
		return selector
	}
	escaped := make([]string, 0, len(containerIDs))
	for _, containerID := range containerIDs {
		escaped = append(escaped, regexpEscape(containerID))
	}
	return fmt.Sprintf(`{server_id=%q,container_id=~"^(%s)$"}`, serverID, strings.Join(escaped, "|"))
}

func queryRawNetdataContainerTelemetry(ctx context.Context, service *monitortsdb.Service, serverID string, targets []ContainerTelemetryTarget, itemsByID map[string]*ContainerTelemetryItem, start, end time.Time, step time.Duration) error {
	for _, target := range targets {
		if target.ID == "" || target.Name == "" {
			continue
		}
		item := itemsByID[target.ID]
		if item == nil {
			continue
		}
		chartMatcher := func(suffix string) string {
			return rawNetdataCgroupChartMatcher(target.Name, suffix)
		}
		networkChartMatcher := rawNetdataCgroupNetworkChartMatcher(target.Name)
		queries := []struct {
			name        string
			unit        string
			query       string
			segment     string
			applyLatest func(float64)
		}{
			{name: "cpu", unit: "percent", query: fmt.Sprintf(`netdata_cgroup_cpu_limit_percentage_average{instance=%q,%s,dimension="used"}`, serverID, chartMatcher("cpu_limit")), applyLatest: func(value float64) { item.Latest.CPUPercent = &value }},
			{name: "memory", unit: "bytes", segment: "usage", query: fmt.Sprintf(`netdata_cgroup_mem_usage_MiB_average{instance=%q,%s,dimension="ram"} * 1048576`, serverID, chartMatcher("mem_usage")), applyLatest: func(value float64) { item.Latest.MemoryUsageBytes = &value }},
			{name: "memory", unit: "bytes", segment: "limit", query: fmt.Sprintf(`sum(netdata_cgroup_mem_usage_limit_MiB_average{instance=%q,%s,dimension=~"used|available"}) * 1048576`, serverID, chartMatcher("mem_usage_limit")), applyLatest: func(value float64) { item.Latest.MemoryLimitBytes = &value }},
			{name: "network", unit: "bytes/s", segment: "in", query: fmt.Sprintf(`sum(netdata_cgroup_net_net_kilobits_persec_average{instance=%q,%s,dimension=~"^(received|receive|rx|in)$"}) * 125`, serverID, networkChartMatcher), applyLatest: func(value float64) { item.Latest.NetworkRxBytesPerSecond = &value }},
			{name: "network", unit: "bytes/s", segment: "out", query: fmt.Sprintf(`sum(netdata_cgroup_net_net_kilobits_persec_average{instance=%q,%s,dimension=~"^(sent|transmit|tx|out)$"}) * 125`, serverID, networkChartMatcher), applyLatest: func(value float64) { item.Latest.NetworkTxBytesPerSecond = &value }},
			{name: "block", unit: "bytes/s", segment: "read", query: fmt.Sprintf(`abs(netdata_cgroup_io_KiB_persec_average{instance=%q,%s,dimension="read"}) * 1024`, serverID, chartMatcher("io")), applyLatest: func(value float64) { item.Latest.BlockReadBytesPerSecond = &value }},
			{name: "block", unit: "bytes/s", segment: "write", query: fmt.Sprintf(`abs(netdata_cgroup_io_KiB_persec_average{instance=%q,%s,dimension="write"}) * 1024`, serverID, chartMatcher("io")), applyLatest: func(value float64) { item.Latest.BlockWriteBytesPerSecond = &value }},
		}
		for _, query := range queries {
			if containerTelemetrySeriesExists(item, query.name, query.segment) {
				continue
			}
			points, err := service.ExecuteQueryRange(ctx, query.query, start, end, step)
			if err != nil {
				continue
			}
			latestValue, observedAt, hasLatest := latestMetricPoint(points)
			if !hasLatest {
				continue
			}
			query.applyLatest(latestValue)
			mergeTelemetryFreshness(item, observedAt, end, step)
			appendContainerTelemetrySeries(item, MetricSeries{Name: query.name, Unit: query.unit, Points: cloneMetricPoints(points)}, query.segment)
		}
	}
	return nil
}

func rawNetdataCgroupNetworkChartMatcher(containerName string) string {
	patterns := make([]string, 0, 2)
	seen := map[string]struct{}{}
	for _, candidate := range []string{containerName, sanitizeNetdataCgroupChartName(containerName)} {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		pattern := regexpEscape("cgroup_"+candidate+".net") + `(_.*)?`
		if _, ok := seen[pattern]; ok {
			continue
		}
		seen[pattern] = struct{}{}
		patterns = append(patterns, pattern)
	}
	return fmt.Sprintf(`chart=~"^(%s)$"`, strings.Join(patterns, "|"))
}

func rawNetdataCgroupChartMatcher(containerName string, suffix string) string {
	charts := make([]string, 0, 2)
	seen := map[string]struct{}{}
	for _, candidate := range []string{containerName, sanitizeNetdataCgroupChartName(containerName)} {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		chart := "cgroup_" + candidate + "." + suffix
		if _, ok := seen[chart]; ok {
			continue
		}
		seen[chart] = struct{}{}
		charts = append(charts, chart)
	}
	if len(charts) == 1 {
		return fmt.Sprintf(`chart=%q`, charts[0])
	}
	escaped := make([]string, 0, len(charts))
	for _, chart := range charts {
		escaped = append(escaped, regexpEscape(chart))
	}
	return fmt.Sprintf(`chart=~"^(%s)$"`, strings.Join(escaped, "|"))
}

func sanitizeNetdataCgroupChartName(value string) string {
	var builder strings.Builder
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '_' {
			builder.WriteRune(char)
			continue
		}
		builder.WriteByte('_')
	}
	return builder.String()
}

func containerTelemetrySeriesExists(item *ContainerTelemetryItem, name string, segment string) bool {
	if item == nil {
		return false
	}
	for _, series := range item.Series {
		if series.Name != name {
			continue
		}
		if segment == "" {
			return len(series.Points) > 0
		}
		for _, existing := range series.Segments {
			if existing.Name == segment && len(existing.Points) > 0 {
				return true
			}
		}
	}
	return false
}

func normalizeContainerTelemetryName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = strings.Split(value, ",")[0]
	value = strings.TrimSpace(strings.TrimPrefix(value, "/"))
	return value
}

func regexpEscape(value string) string {
	replacer := strings.NewReplacer(
		`\`, `\\`,
		`.`, `\\.`,
		`+`, `\\+`,
		`*`, `\\*`,
		`?`, `\\?`,
		`(`, `\\(`,
		`)`, `\\)`,
		`[`, `\\[`,
		`]`, `\\]`,
		`{`, `\\{`,
		`}`, `\\}`,
		`^`, `\\^`,
		`$`, `\\$`,
		`|`, `\\|`,
	)
	return replacer.Replace(value)
}

func cloneMetricPoints(points [][]float64) [][]float64 {
	cloned := make([][]float64, 0, len(points))
	for _, point := range points {
		if len(point) < 2 {
			continue
		}
		cloned = append(cloned, []float64{point[0], point[1]})
	}
	return cloned
}

func latestMetricPoint(points [][]float64) (float64, time.Time, bool) {
	if len(points) == 0 {
		return 0, time.Time{}, false
	}
	last := points[len(points)-1]
	if len(last) < 2 {
		return 0, time.Time{}, false
	}
	return last[1], time.Unix(int64(last[0]), 0).UTC(), true
}

func mergeTelemetryFreshness(item *ContainerTelemetryItem, observedAt, windowEnd time.Time, step time.Duration) {
	if item == nil || observedAt.IsZero() {
		return
	}
	item.Freshness.ObservedAt = observedAt.Format(time.RFC3339)
	staleThreshold := 5 * time.Minute
	if dynamic := 3 * step; dynamic > staleThreshold {
		staleThreshold = dynamic
	}
	if windowEnd.Sub(observedAt) > staleThreshold {
		item.Freshness.State = "stale"
		return
	}
	item.Freshness.State = "fresh"
}

func appendContainerTelemetrySeries(item *ContainerTelemetryItem, next MetricSeries, segmentName string) {
	if item == nil {
		return
	}
	for index := range item.Series {
		if item.Series[index].Name != next.Name {
			continue
		}
		if segmentName == "" {
			item.Series[index].Unit = next.Unit
			item.Series[index].Points = next.Points
			return
		}
		item.Series[index].Unit = next.Unit
		item.Series[index].Segments = append(item.Series[index].Segments, MetricSeriesSegment{Name: segmentName, Points: next.Points})
		return
	}
	if segmentName != "" {
		next.Segments = []MetricSeriesSegment{{Name: segmentName, Points: next.Points}}
		next.Points = nil
	}
	item.Series = append(item.Series, next)
}

func flattenContainerTelemetryItems(itemsByID map[string]*ContainerTelemetryItem) []ContainerTelemetryItem {
	if len(itemsByID) == 0 {
		return []ContainerTelemetryItem{}
	}
	ids := make([]string, 0, len(itemsByID))
	for id := range itemsByID {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	items := make([]ContainerTelemetryItem, 0, len(ids))
	for _, id := range ids {
		item := itemsByID[id]
		if item == nil {
			continue
		}
		sort.SliceStable(item.Series, func(left, right int) bool {
			return item.Series[left].Name < item.Series[right].Name
		})
		items = append(items, *item)
	}
	return items
}
