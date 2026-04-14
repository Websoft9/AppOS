package monitor

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type metricSeriesDefinition struct {
	Metric string
	Unit   string
}

var allowedSeriesQueries = map[string]map[string]metricSeriesDefinition{
	TargetTypeServer: {
		"cpu":    {Metric: "appos_host_cpu_usage", Unit: "percent"},
		"memory": {Metric: "appos_host_memory_bytes", Unit: "bytes"},
	},
	TargetTypeApp: {
		"cpu":    {Metric: "appos_container_cpu_usage", Unit: "percent"},
		"memory": {Metric: "appos_container_memory_bytes", Unit: "bytes"},
	},
	TargetTypePlatform: {
		"cpu":    {Metric: "appos_platform_cpu_percent", Unit: "percent"},
		"memory": {Metric: "appos_platform_memory_bytes", Unit: "bytes"},
	},
}

var allowedSeriesWindows = map[string]struct {
	Duration time.Duration
	Step     time.Duration
}{
	"1h":  {Duration: time.Hour, Step: time.Minute},
	"6h":  {Duration: 6 * time.Hour, Step: 5 * time.Minute},
	"24h": {Duration: 24 * time.Hour, Step: 15 * time.Minute},
}

type metricQueryOverrideFunc func(context.Context, string, string, string, []string) (*MetricSeriesResponse, error)

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

func QueryMetricSeries(ctx context.Context, targetType, targetID, window string, seriesNames []string) (*MetricSeriesResponse, error) {
	targetType = strings.TrimSpace(targetType)
	targetID = strings.TrimSpace(targetID)
	window = strings.TrimSpace(window)
	metricQueryOverrideMu.RLock()
	override := metricQueryOverride
	metricQueryOverrideMu.RUnlock()
	if override != nil {
		return override(ctx, targetType, targetID, window, seriesNames)
	}
	return queryMetricSeriesVM(ctx, targetType, targetID, window, seriesNames)
}

func queryMetricSeriesVM(ctx context.Context, targetType, targetID, window string, seriesNames []string) (*MetricSeriesResponse, error) {
	windowSpec, ok := allowedSeriesWindows[window]
	if !ok {
		return nil, fmt.Errorf("window %q is not allowed", window)
	}
	definitions, ok := allowedSeriesQueries[targetType]
	if !ok {
		return nil, fmt.Errorf("target type %q does not support series queries", targetType)
	}
	baseURL := strings.TrimSpace(os.Getenv(EnvVictoriaMetricsURL))
	response := &MetricSeriesResponse{
		TargetType: targetType,
		TargetID:   targetID,
		Window:     window,
		Series:     make([]MetricSeries, 0, len(seriesNames)),
	}
	requestedSeries := normalizeRequestedSeries(seriesNames)
	for _, requested := range requestedSeries {
		if _, ok := definitions[requested]; !ok {
			return nil, fmt.Errorf("series %q is not allowed for target type %q", requested, targetType)
		}
	}
	if baseURL == "" {
		return response, nil
	}
	client := &http.Client{Timeout: 5 * time.Second}
	end := time.Now().UTC()
	start := end.Add(-windowSpec.Duration)
	for _, requested := range requestedSeries {
		definition := definitions[requested]
		query := fmt.Sprintf(`%s{target_type=%q,target_id=%q}`, definition.Metric, targetType, targetID)
		points, err := executeVMQueryRange(ctx, client, strings.TrimRight(baseURL, "/")+"/api/v1/query_range", query, start, end, windowSpec.Step)
		if err != nil {
			return nil, err
		}
		response.Series = append(response.Series, MetricSeries{Name: requested, Unit: definition.Unit, Points: points})
	}
	return response, nil
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
