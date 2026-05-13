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

var (
	metricQueryOverrideMu sync.RWMutex
	metricQueryOverride   metricQueryOverrideFunc
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
		if targetType == targetTypePlatform && targetID != platformTargetAppOSCore {
			switch requested {
			case "disk", "disk_usage", "network", "network_traffic":
				return nil, fmt.Errorf("series %q is supported only for platform target %q", requested, platformTargetAppOSCore)
			}
		}
	}
	if baseURL == "" {
		return response, nil
	}
	service := monitortsdb.NewService(metricsHTTPClient, baseURL)
	start := windowSpec.Start
	end := windowSpec.End
	if supportsNetworkInterfaceSelection(targetType, targetID) && (containsRequestedSeries(requestedSeries, "network") || containsRequestedSeries(requestedSeries, "network_traffic")) {
		interfaces, err := listNetworkInterfaces(ctx, service, targetID, start, end)
		if err != nil {
			return nil, err
		}
		response.AvailableNetworkInterfaces = interfaces
		response.SelectedNetworkInterface = normalizeNetworkInterface(options.NetworkInterface, interfaces)
	}
	for _, requested := range requestedSeries {
		series, handled, err := buildNetdataMetricSeries(requested, ctx, service, targetType, targetID, response.SelectedNetworkInterface, start, end, windowSpec.Step)
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
