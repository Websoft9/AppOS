package metrics

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	monitortsdb "github.com/websoft9/appos/backend/domain/monitor/metrics/tsdb"
	"github.com/websoft9/appos/backend/domain/runtimecfg"
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
	itemsByAlias := make(map[string]*ContainerTelemetryItem, max(1, len(requestedTargets)))
	for _, target := range requestedTargets {
		item := &ContainerTelemetryItem{
			ContainerID:   target.ID,
			ContainerName: target.Name,
			Freshness:     ContainerTelemetryFreshness{State: "missing"},
		}
		itemsByID[target.ID] = item
		for _, alias := range containerTelemetryTargetAliases(target) {
			itemsByAlias[alias] = item
		}
	}
	baseURL := strings.TrimSpace(runtimecfg.TSDBURL())
	if baseURL == "" {
		response.Items = flattenContainerTelemetryItems(itemsByID)
		return response, nil
	}
	service := monitortsdb.NewService(metricsHTTPClient, baseURL)
	selector := buildContainerTelemetrySelector(serverID, containerTelemetryTargetNames(requestedTargets))
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
			containerID := normalizeContainerTelemetryAlias(series.Metric["container_id"])
			if containerID == "" {
				continue
			}
			item := resolveContainerTelemetryItem(itemsByID, itemsByAlias, containerID, series.Metric)
			if item == nil {
				item = &ContainerTelemetryItem{
					ContainerID: containerID,
					Freshness:   ContainerTelemetryFreshness{State: "missing"},
				}
				itemsByID[containerID] = item
				itemsByAlias[containerID] = item
			}
			if item.ContainerID == "" {
				item.ContainerID = containerID
			}
			itemsByAlias[containerID] = item
			if item.ContainerName == "" {
				item.ContainerName = normalizeContainerTelemetryName(series.Metric["container_name"])
				if item.ContainerName != "" {
					itemsByAlias[item.ContainerName] = item
				}
			}
			if item.ComposeProject == "" {
				item.ComposeProject = firstNonEmptyMetricLabel(series.Metric, "compose_project", "com_docker_compose_project", "com.docker.compose.project")
			}
			if item.ComposeService == "" {
				item.ComposeService = firstNonEmptyMetricLabel(series.Metric, "compose_service", "com_docker_compose_service", "com.docker.compose.service")
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
	response.Items = flattenContainerTelemetryItems(itemsByID)
	return response, nil
}

func resolveContainerTelemetryItem(itemsByID map[string]*ContainerTelemetryItem, itemsByAlias map[string]*ContainerTelemetryItem, containerID string, metric map[string]string) *ContainerTelemetryItem {
	if item := itemsByAlias[containerID]; item != nil {
		return item
	}
	containerName := normalizeContainerTelemetryName(metric["container_name"])
	if containerName != "" {
		if item := itemsByAlias[containerName]; item != nil {
			if strings.TrimSpace(item.ContainerID) == "" {
				item.ContainerID = containerID
			}
			itemsByID[containerID] = item
			return item
		}
	}
	return nil
}

func firstNonEmptyMetricLabel(metric map[string]string, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(metric[key]); value != "" {
			return value
		}
	}
	return ""
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

func containerTelemetryTargetNames(targets []ContainerTelemetryTarget) []string {
	seen := map[string]struct{}{}
	values := make([]string, 0, len(targets))
	for _, target := range targets {
		name := normalizeContainerTelemetryName(target.Name)
		if name == "" {
			name = normalizeContainerTelemetryAlias(target.ID)
		}
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		values = append(values, name)
	}
	sort.Strings(values)
	return values
}

func containerTelemetryTargetAliases(target ContainerTelemetryTarget) []string {
	aliases := make([]string, 0, 1)
	if targetName := normalizeContainerTelemetryName(target.Name); targetName != "" {
		aliases = append(aliases, targetName)
		return aliases
	}
	if targetID := normalizeContainerTelemetryAlias(target.ID); targetID != "" {
		aliases = append(aliases, targetID)
	}
	return aliases
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

func normalizeContainerTelemetryName(value string) string {
	return normalizeContainerTelemetryAlias(value)
}

func normalizeContainerTelemetryAlias(value string) string {
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
