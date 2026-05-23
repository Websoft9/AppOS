package metrics

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	monitortsdb "github.com/websoft9/appos/backend/domain/monitor/metrics/tsdb"
)

type metricQueryOverrideFunc func(context.Context, string, string, string, []string, MetricSeriesQueryOptions) (*MetricSeriesResponse, error)
type metricLatestQueryOverrideFunc func(context.Context, string, string, []string, MetricSeriesQueryOptions) (*MetricLatestResponse, error)

var (
	metricQueryOverrideMu       sync.RWMutex
	metricQueryOverride         metricQueryOverrideFunc
	metricLatestQueryOverrideMu sync.RWMutex
	metricLatestQueryOverride   metricLatestQueryOverrideFunc
)

const (
	agentMetricCadence   = 10 * time.Second
	latestMetricLookback = 30 * time.Second
)

// metricsHTTPClient is reused across metric series queries to enable TCP
// connection pooling to the local VictoriaMetrics instance.
var metricsHTTPClient = &http.Client{Timeout: 5 * time.Second}

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

func SetMetricLatestQueryFuncForTest(fn metricLatestQueryOverrideFunc) func() {
	metricLatestQueryOverrideMu.Lock()
	previous := metricLatestQueryOverride
	metricLatestQueryOverride = fn
	metricLatestQueryOverrideMu.Unlock()
	return func() {
		metricLatestQueryOverrideMu.Lock()
		metricLatestQueryOverride = previous
		metricLatestQueryOverrideMu.Unlock()
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

func QueryLatestMetricSeries(ctx context.Context, targetType, targetID string, seriesNames []string, options MetricSeriesQueryOptions) (*MetricLatestResponse, error) {
	targetType = strings.TrimSpace(targetType)
	targetID = strings.TrimSpace(targetID)
	options.NetworkInterface = strings.TrimSpace(options.NetworkInterface)
	metricLatestQueryOverrideMu.RLock()
	override := metricLatestQueryOverride
	metricLatestQueryOverrideMu.RUnlock()
	if override != nil {
		return override(ctx, targetType, targetID, seriesNames, options)
	}
	return queryLatestMetricSeriesVM(ctx, targetType, targetID, seriesNames, options)
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
	if targetType == targetTypePlatform && targetID != platformTargetAppOSCore {
		for _, requested := range requestedSeries {
			if requested == "disk" || requested == "disk_usage" || requested == "network" || requested == "network_traffic" {
				return nil, fmt.Errorf("series %q is not allowed for platform target %q", requested, targetID)
			}
		}
	}
	for _, requested := range requestedSeries {
		if _, ok := definitions[requested]; !ok {
			return nil, fmt.Errorf("series %q is not allowed for target type %q", requested, targetType)
		}
	}
	if baseURL == "" {
		return response, nil
	}
	service := monitortsdb.NewService(metricsHTTPClient, baseURL)
	start := windowSpec.Start
	end := windowSpec.End
	if supportsNetworkInterfaceSelection(targetType, targetID) && (containsRequestedSeries(requestedSeries, "network") || containsRequestedSeries(requestedSeries, "network_traffic")) {
		interfaces, err := listNetworkInterfaces(ctx, service, targetType, targetID, start, end)
		if err != nil {
			return nil, err
		}
		response.AvailableNetworkInterfaces = interfaces
		response.SelectedNetworkInterface = normalizeNetworkInterface(options.NetworkInterface, interfaces)
	}
	for _, requested := range requestedSeries {
		series, handled, err := buildSpecialMetricSeries(requested, ctx, service, targetType, targetID, response.SelectedNetworkInterface, start, end, windowSpec.Step)
		if err != nil {
			return nil, err
		}
		if handled {
			response.Series = append(response.Series, series)
			continue
		}
		definition := definitions[requested]
		query := definition.BuildQuery(targetType, targetID)
		metadata := map[string]string(nil)
		points, err := executeVMQueryRange(ctx, service, query, start, end, windowSpec.Step)
		if err != nil {
			return nil, err
		}
		response.Series = append(response.Series, MetricSeries{Name: requested, Unit: definition.Unit, Points: points, Metadata: metadata})
	}
	return response, nil
}

func queryLatestMetricSeriesVM(ctx context.Context, targetType, targetID string, seriesNames []string, options MetricSeriesQueryOptions) (*MetricLatestResponse, error) {
	definitions, ok := allowedSeriesQueries[targetType]
	if !ok {
		return nil, fmt.Errorf("target type %q does not support latest queries", targetType)
	}
	response := &MetricLatestResponse{
		TargetType:     targetType,
		TargetID:       targetID,
		CadenceSeconds: int(agentMetricCadence.Seconds()),
		Series:         make([]MetricSeries, 0, len(seriesNames)),
	}
	requestedSeries := normalizeRequestedSeries(seriesNames)
	if targetType == targetTypePlatform && targetID != platformTargetAppOSCore {
		for _, requested := range requestedSeries {
			if requested == "disk" || requested == "disk_usage" || requested == "network" || requested == "network_traffic" {
				return nil, fmt.Errorf("series %q is not allowed for platform target %q", requested, targetID)
			}
		}
	}
	for _, requested := range requestedSeries {
		if _, ok := definitions[requested]; !ok {
			return nil, fmt.Errorf("series %q is not allowed for target type %q", requested, targetType)
		}
	}
	baseURL := strings.TrimSpace(os.Getenv(EnvVictoriaMetricsURL))
	if baseURL == "" {
		return response, nil
	}
	service := monitortsdb.NewService(metricsHTTPClient, baseURL)
	end := time.Now().UTC()
	start := end.Add(-latestMetricLookback)
	if supportsNetworkInterfaceSelection(targetType, targetID) && (containsRequestedSeries(requestedSeries, "network") || containsRequestedSeries(requestedSeries, "network_traffic")) {
		interfaces, err := listNetworkInterfaces(ctx, service, targetType, targetID, start, end)
		if err != nil {
			return nil, err
		}
		response.AvailableNetworkInterfaces = interfaces
		response.SelectedNetworkInterface = normalizeNetworkInterface(options.NetworkInterface, interfaces)
	}
	for _, requested := range requestedSeries {
		series, handled, err := buildSpecialMetricSeries(requested, ctx, service, targetType, targetID, response.SelectedNetworkInterface, start, end, agentMetricCadence)
		if err != nil {
			return nil, err
		}
		if handled {
			response.Series = append(response.Series, latestOnlySeries(series))
			continue
		}
		definition := definitions[requested]
		points, err := executeVMQueryRange(ctx, service, definition.BuildQuery(targetType, targetID), start, end, agentMetricCadence)
		if err != nil {
			return nil, err
		}
		response.Series = append(response.Series, MetricSeries{
			Name:     requested,
			Unit:     definition.Unit,
			Points:   latestOnlyPoints(points),
			Metadata: map[string]string(nil),
		})
	}
	return response, nil
}

func latestOnlySeries(series MetricSeries) MetricSeries {
	trimmed := MetricSeries{
		Name:     series.Name,
		Unit:     series.Unit,
		Metadata: series.Metadata,
	}
	if len(series.Points) > 0 {
		trimmed.Points = latestOnlyPoints(series.Points)
	}
	if len(series.Segments) > 0 {
		trimmed.Segments = make([]MetricSeriesSegment, 0, len(series.Segments))
		for _, segment := range series.Segments {
			trimmed.Segments = append(trimmed.Segments, MetricSeriesSegment{
				Name:   segment.Name,
				Points: latestOnlyPoints(segment.Points),
			})
		}
	}
	return trimmed
}

func latestOnlyPoints(points [][]float64) [][]float64 {
	for index := len(points) - 1; index >= 0; index -= 1 {
		point := points[index]
		if len(point) < 2 {
			continue
		}
		if !isFiniteMetricValue(point[0]) || !isFiniteMetricValue(point[1]) {
			continue
		}
		return [][]float64{{point[0], point[1]}}
	}
	return [][]float64{}
}

func isFiniteMetricValue(value float64) bool {
	return !((value != value) || value > 1<<62 || value < -(1<<62))
}
