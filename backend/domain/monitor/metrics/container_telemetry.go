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

type containerTelemetryQueryOverrideFunc func(context.Context, string, []string, string) (*ContainerTelemetryResponse, error)

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

func QueryContainerTelemetry(ctx context.Context, serverID string, containerIDs []string, window string) (*ContainerTelemetryResponse, error) {
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
		return override(ctx, serverID, containerIDs, window)
	}
	return queryContainerTelemetryVM(ctx, serverID, containerIDs, window)
}

func queryContainerTelemetryVM(ctx context.Context, serverID string, containerIDs []string, window string) (*ContainerTelemetryResponse, error) {
	windowSpec, err := resolveMetricSeriesWindow(window, MetricSeriesQueryOptions{}, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	requestedIDs := normalizeContainerIDs(containerIDs)
	response := &ContainerTelemetryResponse{
		ServerID:     serverID,
		Window:       windowSpec.Label,
		RangeStartAt: windowSpec.Start.Format(time.RFC3339),
		RangeEndAt:   windowSpec.End.Format(time.RFC3339),
		StepSeconds:  int(windowSpec.Step.Seconds()),
		Items:        make([]ContainerTelemetryItem, 0, max(1, len(requestedIDs))),
	}
	itemsByID := make(map[string]*ContainerTelemetryItem, len(requestedIDs))
	for _, containerID := range requestedIDs {
		item := &ContainerTelemetryItem{
			ContainerID: containerID,
			Freshness:   ContainerTelemetryFreshness{State: "missing"},
		}
		itemsByID[containerID] = item
	}
	baseURL := strings.TrimSpace(os.Getenv(EnvVictoriaMetricsURL))
	if baseURL == "" {
		response.Items = flattenContainerTelemetryItems(itemsByID)
		return response, nil
	}
	service := monitortsdb.NewService(metricsHTTPClient, baseURL)
	selector := buildContainerTelemetrySelector(serverID, requestedIDs)
	queries := []struct {
		name    string
		unit    string
		series  string
		segment string
	}{
		{name: "cpu", unit: "percent", series: "appos_container_cpu_usage"},
		{name: "memory", unit: "bytes", series: "appos_container_memory_bytes"},
		{name: "network", unit: "bytes/s", series: "appos_container_network_receive_bytes_per_second", segment: "in"},
		{name: "network", unit: "bytes/s", series: "appos_container_network_transmit_bytes_per_second", segment: "out"},
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
				case "appos_container_cpu_usage":
					item.Latest.CPUPercent = &latestValue
				case "appos_container_memory_bytes":
					item.Latest.MemoryBytes = &latestValue
				case "appos_container_network_receive_bytes_per_second":
					item.Latest.NetworkRxBytesPerSecond = &latestValue
				case "appos_container_network_transmit_bytes_per_second":
					item.Latest.NetworkTxBytesPerSecond = &latestValue
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
	response.Items = flattenContainerTelemetryItems(itemsByID)
	return response, nil
}

func normalizeContainerIDs(values []string) []string {
	seen := map[string]struct{}{}
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			if _, ok := seen[part]; ok {
				continue
			}
			seen[part] = struct{}{}
			normalized = append(normalized, part)
		}
	}
	sort.Strings(normalized)
	return normalized
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

func regexpEscape(value string) string {
	replacer := strings.NewReplacer(
		`\`, `\\`,
		`.`, `\.`,
		`+`, `\+`,
		`*`, `\*`,
		`?`, `\?`,
		`(`, `\(`,
		`)`, `\)`,
		`[`, `\[`,
		`]`, `\]`,
		`{`, `\{`,
		`}`, `\}`,
		`^`, `\^`,
		`$`, `\$`,
		`|`, `\|`,
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
