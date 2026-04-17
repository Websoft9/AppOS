package monitor

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type metricSeriesDefinition struct {
	Unit       string
	BuildQuery func(targetType, targetID string) string
}

const allNetworkInterfaces = "all"

var allowedSeriesQueries = map[string]map[string]metricSeriesDefinition{
	TargetTypeServer: {
		"cpu": {
			Unit: "percent",
			BuildQuery: func(_ string, targetID string) string {
				return fmt.Sprintf(`100 - netdata_system_cpu_percentage_average{instance=%q,dimension="idle"}`, targetID)
			},
		},
		"memory": {
			Unit: "bytes",
			BuildQuery: func(_ string, targetID string) string {
				return fmt.Sprintf(`netdata_system_ram_MiB_average{instance=%q,dimension="used"} * 1048576`, targetID)
			},
		},
		"disk": {
			Unit: "bytes/s",
			BuildQuery: func(_ string, targetID string) string {
				return fmt.Sprintf(`sum(netdata_system_io_KiB_persec_average{instance=%q,dimension=~"reads|writes"}) * 1024`, targetID)
			},
		},
		"disk_usage": {
			Unit: "percent",
			BuildQuery: func(_ string, targetID string) string {
				return fmt.Sprintf(`100 * sum(netdata_disk_space_GiB_average{instance=%q,family="/",dimension="used"}) / sum(netdata_disk_space_GiB_average{instance=%q,family="/",dimension=~"avail|used|reserved_for_root"})`, targetID, targetID)
			},
		},
		"network": {
			Unit: "bytes/s",
			BuildQuery: func(_ string, targetID string) string {
				return fmt.Sprintf(`sum(netdata_system_net_kilobits_persec_average{instance=%q,dimension=~"received|sent"}) * 125`, targetID)
			},
		},
		"network_traffic": {
			Unit: "GB",
			BuildQuery: func(_ string, targetID string) string {
				return fmt.Sprintf(`sum(netdata_system_net_kilobits_persec_average{instance=%q,dimension=~"received|sent"}) * 125`, targetID)
			},
		},
	},
	TargetTypeApp: {
		"cpu":    metricSelectorDefinition("appos_container_cpu_usage", "percent"),
		"memory": metricSelectorDefinition("appos_container_memory_bytes", "bytes"),
	},
	TargetTypePlatform: {
		"cpu": {
			Unit: "percent",
			BuildQuery: func(targetType, targetID string) string {
				if targetID == PlatformTargetAppOSCore {
					return fmt.Sprintf(`100 - netdata_system_cpu_percentage_average{instance=%q,dimension="idle"}`, PlatformTargetAppOSCore)
				}
				return metricSelectorQuery("appos_platform_cpu_percent", targetType, targetID)
			},
		},
		"memory": {
			Unit: "bytes",
			BuildQuery: func(targetType, targetID string) string {
				if targetID == PlatformTargetAppOSCore {
					return fmt.Sprintf(`netdata_system_ram_MiB_average{instance=%q,dimension="used"} * 1048576`, PlatformTargetAppOSCore)
				}
				return metricSelectorQuery("appos_platform_memory_bytes", targetType, targetID)
			},
		},
		"disk": {
			Unit: "bytes/s",
			BuildQuery: func(_ string, targetID string) string {
				if targetID == PlatformTargetAppOSCore {
					return fmt.Sprintf(`sum(netdata_system_io_KiB_persec_average{instance=%q,dimension=~"reads|writes"}) * 1024`, PlatformTargetAppOSCore)
				}
				return ""
			},
		},
		"disk_usage": {
			Unit: "percent",
			BuildQuery: func(_ string, targetID string) string {
				if targetID == PlatformTargetAppOSCore {
					return fmt.Sprintf(`100 * sum(netdata_disk_space_GiB_average{instance=%q,family="/",dimension="used"}) / sum(netdata_disk_space_GiB_average{instance=%q,family="/",dimension=~"avail|used|reserved_for_root"})`, PlatformTargetAppOSCore, PlatformTargetAppOSCore)
				}
				return ""
			},
		},
		"network": {
			Unit: "bytes/s",
			BuildQuery: func(_ string, targetID string) string {
				if targetID == PlatformTargetAppOSCore {
					return fmt.Sprintf(`sum(netdata_system_net_kilobits_persec_average{instance=%q,dimension=~"received|sent"}) * 125`, PlatformTargetAppOSCore)
				}
				return ""
			},
		},
		"network_traffic": {
			Unit: "GB",
			BuildQuery: func(_ string, targetID string) string {
				if targetID == PlatformTargetAppOSCore {
					return fmt.Sprintf(`sum(netdata_system_net_kilobits_persec_average{instance=%q,dimension=~"received|sent"}) * 125`, PlatformTargetAppOSCore)
				}
				return ""
			},
		},
	},
}

var allowedSeriesWindows = map[string]struct {
	Duration time.Duration
	Step     time.Duration
}{
	"1h":  {Duration: time.Hour, Step: time.Minute},
	"5h":  {Duration: 5 * time.Hour, Step: 5 * time.Minute},
	"12h": {Duration: 12 * time.Hour, Step: 10 * time.Minute},
	"1d":  {Duration: 24 * time.Hour, Step: 15 * time.Minute},
	"24h": {Duration: 24 * time.Hour, Step: 15 * time.Minute},
	"7d":  {Duration: 7 * 24 * time.Hour, Step: time.Hour},
}

type metricSeriesWindowSpec struct {
	Label string
	Start time.Time
	End   time.Time
	Step  time.Duration
}

type metricQueryOverrideFunc func(context.Context, string, string, string, []string, MetricSeriesQueryOptions) (*MetricSeriesResponse, error)

var (
	metricQueryOverrideMu sync.RWMutex
	metricQueryOverride   metricQueryOverrideFunc
)

func SetMetricQueryFuncForTest(fn metricQueryOverrideFunc) func() {
	metricQueryOverrideMu.Lock()
	previous := metricQueryOverride
	metricQueryOverride = fn
	metricQueryOverrideMu.Unlock()
	return func() {
		metricQueryOverrideMu.Lock()
		metricQueryOverride = previous
		metricQueryOverrideMu.Unlock()
	}
}

func QueryMetricSeries(ctx context.Context, targetType, targetID, window string, seriesNames []string, options MetricSeriesQueryOptions) (*MetricSeriesResponse, error) {
	targetType = strings.TrimSpace(targetType)
	targetID = strings.TrimSpace(targetID)
	window = strings.TrimSpace(window)
	options.NetworkInterface = strings.TrimSpace(options.NetworkInterface)
	if options.StartAt != nil {
		startAt := options.StartAt.UTC()
		options.StartAt = &startAt
	}
	if options.EndAt != nil {
		endAt := options.EndAt.UTC()
		options.EndAt = &endAt
	}
	metricQueryOverrideMu.RLock()
	override := metricQueryOverride
	metricQueryOverrideMu.RUnlock()
	if override != nil {
		return override(ctx, targetType, targetID, window, seriesNames, options)
	}
	return queryMetricSeriesVM(ctx, targetType, targetID, window, seriesNames, options)
}

func queryMetricSeriesVM(ctx context.Context, targetType, targetID, window string, seriesNames []string, options MetricSeriesQueryOptions) (*MetricSeriesResponse, error) {
	windowSpec, err := resolveMetricSeriesWindow(window, options, time.Now().UTC())
	if err != nil {
		return nil, err
	}
	definitions, ok := allowedSeriesQueries[targetType]
	if !ok {
		return nil, fmt.Errorf("target type %q does not support series queries", targetType)
	}
	baseURL := strings.TrimSpace(os.Getenv(EnvVictoriaMetricsURL))
	response := &MetricSeriesResponse{
		TargetType:   targetType,
		TargetID:     targetID,
		Window:       windowSpec.Label,
		RangeStartAt: windowSpec.Start.Format(time.RFC3339),
		RangeEndAt:   windowSpec.End.Format(time.RFC3339),
		StepSeconds:  int(windowSpec.Step.Seconds()),
		Series:       make([]MetricSeries, 0, len(seriesNames)),
	}
	requestedSeries := normalizeRequestedSeries(seriesNames)
	for _, requested := range requestedSeries {
		if _, ok := definitions[requested]; !ok {
			return nil, fmt.Errorf("series %q is not allowed for target type %q", requested, targetType)
		}
		if targetType == TargetTypePlatform && targetID != PlatformTargetAppOSCore {
			switch requested {
			case "disk", "disk_usage", "network", "network_traffic":
				return nil, fmt.Errorf("series %q is supported only for platform target %q", requested, PlatformTargetAppOSCore)
			}
		}
	}
	if baseURL == "" {
		return response, nil
	}
	client := &http.Client{Timeout: 5 * time.Second}
	start := windowSpec.Start
	end := windowSpec.End
	if supportsNetworkInterfaceSelection(targetType, targetID) && (containsRequestedSeries(requestedSeries, "network") || containsRequestedSeries(requestedSeries, "network_traffic")) {
		interfaces, err := listNetworkInterfaces(ctx, client, strings.TrimRight(baseURL, "/")+"/api/v1/series", targetID, start, end)
		if err != nil {
			return nil, err
		}
		response.AvailableNetworkInterfaces = interfaces
		response.SelectedNetworkInterface = normalizeNetworkInterface(options.NetworkInterface, interfaces)
	}
	for _, requested := range requestedSeries {
		if requested == "memory" && isNetdataPlatformTarget(targetType, targetID) {
			usedPoints, err := executeVMQueryRange(
				ctx,
				client,
				strings.TrimRight(baseURL, "/")+"/api/v1/query_range",
				fmt.Sprintf(`sum(netdata_system_ram_MiB_average{instance=%q,dimension="used"}) * 1048576`, targetID),
				start,
				end,
				windowSpec.Step,
			)
			if err != nil {
				return nil, err
			}
			availablePoints, err := executeVMQueryRange(
				ctx,
				client,
				strings.TrimRight(baseURL, "/")+"/api/v1/query_range",
				fmt.Sprintf(`sum(netdata_system_ram_MiB_average{instance=%q,dimension=~"free|cached|buffers"}) * 1048576`, targetID),
				start,
				end,
				windowSpec.Step,
			)
			if err != nil {
				return nil, err
			}
			response.Series = append(response.Series, MetricSeries{
				Name: "memory",
				Unit: "bytes",
				Segments: []MetricSeriesSegment{
					{Name: "used", Points: usedPoints},
					{Name: "available", Points: availablePoints},
				},
			})
			continue
		}
		if requested == "memory" && targetType == TargetTypeServer {
			usedPoints, err := executeVMQueryRange(
				ctx,
				client,
				strings.TrimRight(baseURL, "/")+"/api/v1/query_range",
				fmt.Sprintf(`sum(netdata_system_ram_MiB_average{instance=%q,dimension="used"}) * 1048576`, targetID),
				start,
				end,
				windowSpec.Step,
			)
			if err != nil {
				return nil, err
			}
			availablePoints, err := executeVMQueryRange(
				ctx,
				client,
				strings.TrimRight(baseURL, "/")+"/api/v1/query_range",
				fmt.Sprintf(`sum(netdata_system_ram_MiB_average{instance=%q,dimension=~"free|cached|buffers"}) * 1048576`, targetID),
				start,
				end,
				windowSpec.Step,
			)
			if err != nil {
				return nil, err
			}
			response.Series = append(response.Series, MetricSeries{
				Name: "memory",
				Unit: "bytes",
				Segments: []MetricSeriesSegment{
					{Name: "used", Points: usedPoints},
					{Name: "available", Points: availablePoints},
				},
			})
			continue
		}
		if requested == "disk" && isNetdataPlatformTarget(targetType, targetID) {
			readPoints, err := executeVMQueryRange(
				ctx,
				client,
				strings.TrimRight(baseURL, "/")+"/api/v1/query_range",
				fmt.Sprintf(`sum(netdata_system_io_KiB_persec_average{instance=%q,dimension="reads"}) * 1024`, targetID),
				start,
				end,
				windowSpec.Step,
			)
			if err != nil {
				return nil, err
			}
			writePoints, err := executeVMQueryRange(
				ctx,
				client,
				strings.TrimRight(baseURL, "/")+"/api/v1/query_range",
				fmt.Sprintf(`sum(netdata_system_io_KiB_persec_average{instance=%q,dimension="writes"}) * 1024`, targetID),
				start,
				end,
				windowSpec.Step,
			)
			if err != nil {
				return nil, err
			}
			response.Series = append(response.Series, MetricSeries{
				Name: "disk",
				Unit: "bytes/s",
				Segments: []MetricSeriesSegment{
					{Name: "read", Points: readPoints},
					{Name: "write", Points: writePoints},
				},
			})
			continue
		}
		if requested == "disk" && targetType == TargetTypeServer {
			readPoints, err := executeVMQueryRange(
				ctx,
				client,
				strings.TrimRight(baseURL, "/")+"/api/v1/query_range",
				fmt.Sprintf(`sum(netdata_system_io_KiB_persec_average{instance=%q,dimension="reads"}) * 1024`, targetID),
				start,
				end,
				windowSpec.Step,
			)
			if err != nil {
				return nil, err
			}
			writePoints, err := executeVMQueryRange(
				ctx,
				client,
				strings.TrimRight(baseURL, "/")+"/api/v1/query_range",
				fmt.Sprintf(`sum(netdata_system_io_KiB_persec_average{instance=%q,dimension="writes"}) * 1024`, targetID),
				start,
				end,
				windowSpec.Step,
			)
			if err != nil {
				return nil, err
			}
			response.Series = append(response.Series, MetricSeries{
				Name: "disk",
				Unit: "bytes/s",
				Segments: []MetricSeriesSegment{
					{Name: "read", Points: readPoints},
					{Name: "write", Points: writePoints},
				},
			})
			continue
		}
		if requested == "network" && isNetdataPlatformTarget(targetType, targetID) {
			selected := response.SelectedNetworkInterface
			if selected == "" {
				selected = allNetworkInterfaces
			}
			receivedQuery := fmt.Sprintf(`sum(netdata_system_net_kilobits_persec_average{instance=%q,dimension="received"}) * 125`, targetID)
			sentQuery := fmt.Sprintf(`sum(netdata_system_net_kilobits_persec_average{instance=%q,dimension="sent"}) * 125`, targetID)
			metadata := map[string]string(nil)
			if selected != allNetworkInterfaces {
				receivedQuery = fmt.Sprintf(`sum(netdata_net_net_kilobits_persec_average{instance=%q,device=%q,dimension="received"}) * 125`, targetID, selected)
				sentQuery = fmt.Sprintf(`sum(netdata_net_net_kilobits_persec_average{instance=%q,device=%q,dimension="sent"}) * 125`, targetID, selected)
				metadata = map[string]string{"network_interface": selected}
			}
			receivedPoints, err := executeVMQueryRange(ctx, client, strings.TrimRight(baseURL, "/")+"/api/v1/query_range", receivedQuery, start, end, windowSpec.Step)
			if err != nil {
				return nil, err
			}
			sentPoints, err := executeVMQueryRange(ctx, client, strings.TrimRight(baseURL, "/")+"/api/v1/query_range", sentQuery, start, end, windowSpec.Step)
			if err != nil {
				return nil, err
			}
			response.Series = append(response.Series, MetricSeries{
				Name: "network",
				Unit: "bytes/s",
				Segments: []MetricSeriesSegment{
					{Name: "in", Points: receivedPoints},
					{Name: "out", Points: sentPoints},
				},
				Metadata: metadata,
			})
			continue
		}
		if requested == "network" && targetType == TargetTypeServer {
			selected := response.SelectedNetworkInterface
			if selected == "" {
				selected = allNetworkInterfaces
			}
			receivedQuery := fmt.Sprintf(`sum(netdata_system_net_kilobits_persec_average{instance=%q,dimension="received"}) * 125`, targetID)
			sentQuery := fmt.Sprintf(`sum(netdata_system_net_kilobits_persec_average{instance=%q,dimension="sent"}) * 125`, targetID)
			metadata := map[string]string(nil)
			if selected != allNetworkInterfaces {
				receivedQuery = fmt.Sprintf(`sum(netdata_net_net_kilobits_persec_average{instance=%q,device=%q,dimension="received"}) * 125`, targetID, selected)
				sentQuery = fmt.Sprintf(`sum(netdata_net_net_kilobits_persec_average{instance=%q,device=%q,dimension="sent"}) * 125`, targetID, selected)
				metadata = map[string]string{"network_interface": selected}
			}
			receivedPoints, err := executeVMQueryRange(ctx, client, strings.TrimRight(baseURL, "/")+"/api/v1/query_range", receivedQuery, start, end, windowSpec.Step)
			if err != nil {
				return nil, err
			}
			sentPoints, err := executeVMQueryRange(ctx, client, strings.TrimRight(baseURL, "/")+"/api/v1/query_range", sentQuery, start, end, windowSpec.Step)
			if err != nil {
				return nil, err
			}
			response.Series = append(response.Series, MetricSeries{
				Name: "network",
				Unit: "bytes/s",
				Segments: []MetricSeriesSegment{
					{Name: "in", Points: receivedPoints},
					{Name: "out", Points: sentPoints},
				},
				Metadata: metadata,
			})
			continue
		}
		if requested == "network_traffic" && isNetdataPlatformTarget(targetType, targetID) {
			selected := response.SelectedNetworkInterface
			if selected == "" {
				selected = allNetworkInterfaces
			}
			receivedQuery := fmt.Sprintf(`sum(netdata_system_net_kilobits_persec_average{instance=%q,dimension="received"}) * 125`, targetID)
			sentQuery := fmt.Sprintf(`sum(netdata_system_net_kilobits_persec_average{instance=%q,dimension="sent"}) * 125`, targetID)
			metadata := map[string]string(nil)
			if selected != allNetworkInterfaces {
				receivedQuery = fmt.Sprintf(`sum(netdata_net_net_kilobits_persec_average{instance=%q,device=%q,dimension="received"}) * 125`, targetID, selected)
				sentQuery = fmt.Sprintf(`sum(netdata_net_net_kilobits_persec_average{instance=%q,device=%q,dimension="sent"}) * 125`, targetID, selected)
				metadata = map[string]string{"network_interface": selected}
			}
			receivedPoints, err := executeVMQueryRange(ctx, client, strings.TrimRight(baseURL, "/")+"/api/v1/query_range", receivedQuery, start, end, windowSpec.Step)
			if err != nil {
				return nil, err
			}
			sentPoints, err := executeVMQueryRange(ctx, client, strings.TrimRight(baseURL, "/")+"/api/v1/query_range", sentQuery, start, end, windowSpec.Step)
			if err != nil {
				return nil, err
			}
			receivedPoints = scalePoints(receivedPoints, float64(windowSpec.Step)/float64(time.Second)/(1024*1024*1024))
			sentPoints = scalePoints(sentPoints, float64(windowSpec.Step)/float64(time.Second)/(1024*1024*1024))
			response.Series = append(response.Series, MetricSeries{
				Name: "network_traffic",
				Unit: "GB",
				Segments: []MetricSeriesSegment{
					{Name: "in", Points: receivedPoints},
					{Name: "out", Points: sentPoints},
				},
				Metadata: metadata,
			})
			continue
		}
		if requested == "disk_usage" && isNetdataPlatformTarget(targetType, targetID) {
			usedPoints, err := executeVMQueryRange(
				ctx,
				client,
				strings.TrimRight(baseURL, "/")+"/api/v1/query_range",
				fmt.Sprintf(`sum(netdata_disk_space_GiB_average{instance=%q,family="/",dimension="used"}) * 1073741824`, targetID),
				start,
				end,
				windowSpec.Step,
			)
			if err != nil {
				return nil, err
			}
			freePoints, err := executeVMQueryRange(
				ctx,
				client,
				strings.TrimRight(baseURL, "/")+"/api/v1/query_range",
				fmt.Sprintf(`sum(netdata_disk_space_GiB_average{instance=%q,family="/",dimension=~"avail|reserved_for_root"}) * 1073741824`, targetID),
				start,
				end,
				windowSpec.Step,
			)
			if err != nil {
				return nil, err
			}
			response.Series = append(response.Series, MetricSeries{
				Name: "disk_usage",
				Unit: "bytes",
				Segments: []MetricSeriesSegment{
					{Name: "used", Points: usedPoints},
					{Name: "free", Points: freePoints},
				},
			})
			continue
		}
		if requested == "disk_usage" {
			usedPoints, err := executeVMQueryRange(
				ctx,
				client,
				strings.TrimRight(baseURL, "/")+"/api/v1/query_range",
				fmt.Sprintf(`sum(netdata_disk_space_GiB_average{instance=%q,family="/",dimension="used"}) * 1073741824`, targetID),
				start,
				end,
				windowSpec.Step,
			)
			if err != nil {
				return nil, err
			}
			freePoints, err := executeVMQueryRange(
				ctx,
				client,
				strings.TrimRight(baseURL, "/")+"/api/v1/query_range",
				fmt.Sprintf(`sum(netdata_disk_space_GiB_average{instance=%q,family="/",dimension=~"avail|reserved_for_root"}) * 1073741824`, targetID),
				start,
				end,
				windowSpec.Step,
			)
			if err != nil {
				return nil, err
			}
			response.Series = append(response.Series, MetricSeries{
				Name: "disk_usage",
				Unit: "bytes",
				Segments: []MetricSeriesSegment{
					{Name: "used", Points: usedPoints},
					{Name: "free", Points: freePoints},
				},
			})
			continue
		}
		if requested == "network_traffic" && targetType == TargetTypeServer {
			selected := response.SelectedNetworkInterface
			if selected == "" {
				selected = allNetworkInterfaces
			}
			receivedQuery := fmt.Sprintf(`sum(netdata_system_net_kilobits_persec_average{instance=%q,dimension="received"}) * 125`, targetID)
			sentQuery := fmt.Sprintf(`sum(netdata_system_net_kilobits_persec_average{instance=%q,dimension="sent"}) * 125`, targetID)
			metadata := map[string]string(nil)
			if selected != allNetworkInterfaces {
				receivedQuery = fmt.Sprintf(`sum(netdata_net_net_kilobits_persec_average{instance=%q,device=%q,dimension="received"}) * 125`, targetID, selected)
				sentQuery = fmt.Sprintf(`sum(netdata_net_net_kilobits_persec_average{instance=%q,device=%q,dimension="sent"}) * 125`, targetID, selected)
				metadata = map[string]string{"network_interface": selected}
			}
			receivedPoints, err := executeVMQueryRange(ctx, client, strings.TrimRight(baseURL, "/")+"/api/v1/query_range", receivedQuery, start, end, windowSpec.Step)
			if err != nil {
				return nil, err
			}
			sentPoints, err := executeVMQueryRange(ctx, client, strings.TrimRight(baseURL, "/")+"/api/v1/query_range", sentQuery, start, end, windowSpec.Step)
			if err != nil {
				return nil, err
			}
			receivedPoints = scalePoints(receivedPoints, float64(windowSpec.Step)/float64(time.Second)/(1024*1024*1024))
			sentPoints = scalePoints(sentPoints, float64(windowSpec.Step)/float64(time.Second)/(1024*1024*1024))
			response.Series = append(response.Series, MetricSeries{
				Name: "network_traffic",
				Unit: "GB",
				Segments: []MetricSeriesSegment{
					{Name: "in", Points: receivedPoints},
					{Name: "out", Points: sentPoints},
				},
				Metadata: metadata,
			})
			continue
		}
		definition := definitions[requested]
		query := definition.BuildQuery(targetType, targetID)
		metadata := map[string]string(nil)
		points, err := executeVMQueryRange(ctx, client, strings.TrimRight(baseURL, "/")+"/api/v1/query_range", query, start, end, windowSpec.Step)
		if err != nil {
			return nil, err
		}
		response.Series = append(response.Series, MetricSeries{Name: requested, Unit: definition.Unit, Points: points, Metadata: metadata})
	}
	return response, nil
}

func isNetdataPlatformTarget(targetType, targetID string) bool {
	return targetType == TargetTypePlatform && targetID == PlatformTargetAppOSCore
}

func supportsNetworkInterfaceSelection(targetType, targetID string) bool {
	if targetType == TargetTypeServer {
		return true
	}
	return isNetdataPlatformTarget(targetType, targetID)
}

func resolveMetricSeriesWindow(window string, options MetricSeriesQueryOptions, now time.Time) (metricSeriesWindowSpec, error) {
	if options.StartAt != nil || options.EndAt != nil {
		if options.StartAt == nil || options.EndAt == nil {
			return metricSeriesWindowSpec{}, fmt.Errorf("custom range requires both startAt and endAt")
		}
		start := options.StartAt.UTC()
		end := options.EndAt.UTC()
		if !end.After(start) {
			return metricSeriesWindowSpec{}, fmt.Errorf("custom range endAt must be after startAt")
		}
		return metricSeriesWindowSpec{
			Label: "custom",
			Start: start,
			End:   end,
			Step:  stepForSeriesDuration(end.Sub(start)),
		}, nil
	}
	windowSpec, ok := allowedSeriesWindows[window]
	if !ok {
		return metricSeriesWindowSpec{}, fmt.Errorf("window %q is not allowed", window)
	}
	end := now.UTC()
	start := end.Add(-windowSpec.Duration)
	return metricSeriesWindowSpec{
		Label: window,
		Start: start,
		End:   end,
		Step:  windowSpec.Step,
	}, nil
}

func stepForSeriesDuration(duration time.Duration) time.Duration {
	switch {
	case duration <= time.Hour:
		return time.Minute
	case duration <= 5*time.Hour:
		return 5 * time.Minute
	case duration <= 12*time.Hour:
		return 10 * time.Minute
	case duration <= 24*time.Hour:
		return 15 * time.Minute
	case duration <= 7*24*time.Hour:
		return time.Hour
	default:
		return 6 * time.Hour
	}
}

func containsRequestedSeries(seriesNames []string, target string) bool {
	for _, name := range seriesNames {
		if name == target {
			return true
		}
	}
	return false
}

func normalizeNetworkInterface(value string, available []string) string {
	value = strings.TrimSpace(value)
	if value == "" || strings.EqualFold(value, allNetworkInterfaces) {
		return allNetworkInterfaces
	}
	for _, item := range available {
		if item == value {
			return value
		}
	}
	return allNetworkInterfaces
}

func normalizeRequestedSeries(seriesNames []string) []string {
	if len(seriesNames) == 0 {
		return []string{"cpu", "memory"}
	}
	seen := map[string]struct{}{}
	normalized := make([]string, 0, len(seriesNames))
	for _, name := range seriesNames {
		for _, part := range strings.Split(name, ",") {
			part = strings.ToLower(strings.TrimSpace(part))
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
	return normalized
}

func metricSelectorDefinition(metric string, unit string) metricSeriesDefinition {
	return metricSeriesDefinition{
		Unit: unit,
		BuildQuery: func(targetType, targetID string) string {
			return metricSelectorQuery(metric, targetType, targetID)
		},
	}
}

func metricSelectorQuery(metric string, targetType string, targetID string) string {
	return fmt.Sprintf(`%s{target_type=%q,target_id=%q}`, metric, targetType, targetID)
}

func scalePoints(points [][]float64, multiplier float64) [][]float64 {
	scaled := make([][]float64, 0, len(points))
	for _, point := range points {
		if len(point) < 2 {
			continue
		}
		scaled = append(scaled, []float64{point[0], point[1] * multiplier})
	}
	return scaled
}

func listNetworkInterfaces(ctx context.Context, client *http.Client, endpoint, targetID string, start, end time.Time) ([]string, error) {
	params := url.Values{}
	params.Add("match[]", fmt.Sprintf(`netdata_net_net_kilobits_persec_average{instance=%q}`, targetID))
	params.Set("start", fmt.Sprintf("%d", start.Unix()))
	params.Set("end", fmt.Sprintf("%d", end.Unix()))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("victoriametrics series lookup failed with status %d", resp.StatusCode)
	}
	var payload struct {
		Status string              `json:"status"`
		Data   []map[string]string `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	if payload.Status != "success" {
		return nil, fmt.Errorf("victoriametrics series lookup did not succeed")
	}
	seen := map[string]struct{}{}
	interfaces := make([]string, 0, len(payload.Data))
	for _, series := range payload.Data {
		device := strings.TrimSpace(series["device"])
		if device == "" {
			continue
		}
		if _, ok := seen[device]; ok {
			continue
		}
		seen[device] = struct{}{}
		interfaces = append(interfaces, device)
	}
	sort.Strings(interfaces)
	return interfaces, nil
}

func executeVMQueryRange(ctx context.Context, client *http.Client, endpoint, query string, start, end time.Time, step time.Duration) ([][]float64, error) {
	params := url.Values{}
	params.Set("query", query)
	params.Set("start", fmt.Sprintf("%d", start.Unix()))
	params.Set("end", fmt.Sprintf("%d", end.Unix()))
	params.Set("step", fmt.Sprintf("%ds", int(step.Seconds())))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("victoriametrics query failed with status %d", resp.StatusCode)
	}
	var payload struct {
		Status string `json:"status"`
		Data   struct {
			Result []struct {
				Values [][]any `json:"values"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	if payload.Status != "success" {
		return nil, fmt.Errorf("victoriametrics query did not succeed")
	}
	if len(payload.Data.Result) == 0 {
		return [][]float64{}, nil
	}
	points := make([][]float64, 0, len(payload.Data.Result[0].Values))
	for _, raw := range payload.Data.Result[0].Values {
		if len(raw) != 2 {
			continue
		}
		timestamp, ok := coerceMetricFloat(raw[0])
		if !ok {
			continue
		}
		value, ok := coerceMetricFloat(raw[1])
		if !ok {
			continue
		}
		points = append(points, []float64{timestamp, value})
	}
	return points, nil
}

func coerceMetricFloat(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case string:
		result, err := strconv.ParseFloat(typed, 64)
		if err != nil {
			return 0, false
		}
		return result, true
	case json.Number:
		result, err := typed.Float64()
		if err != nil {
			return 0, false
		}
		return result, true
	default:
		return 0, false
	}
}
