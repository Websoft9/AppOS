package metrics_test

import (
	"context"
	"testing"
	"time"

	metrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
)

func TestQueryServerMetricsFreshnessUsesBoundedRange(t *testing.T) {
	now := time.Date(2026, 5, 13, 12, 0, 0, 0, time.UTC)
	var gotOptions metrics.MetricSeriesQueryOptions
	restore := metrics.SetMetricQueryFuncForTest(func(_ context.Context, targetType, targetID, window string, seriesNames []string, options metrics.MetricSeriesQueryOptions) (*metrics.MetricSeriesResponse, error) {
		gotOptions = options
		return &metrics.MetricSeriesResponse{TargetType: targetType, TargetID: targetID, Window: window, Series: []metrics.MetricSeries{{
			Name:   seriesNames[0],
			Unit:   "percent",
			Points: [][]float64{{float64(now.Add(-20 * time.Second).Unix()), 42}},
		}}}, nil
	})
	defer restore()

	observation, err := metrics.QueryServerMetricsFreshness(context.Background(), "srv-1", now)
	if err != nil {
		t.Fatal(err)
	}
	if !observation.HasSample {
		t.Fatal("expected freshness sample")
	}
	if gotOptions.StartAt == nil || gotOptions.EndAt == nil {
		t.Fatalf("expected bounded freshness range, got %+v", gotOptions)
	}
	if !gotOptions.EndAt.Equal(now) {
		t.Fatalf("expected endAt %s, got %s", now, gotOptions.EndAt)
	}
	if got := gotOptions.EndAt.Sub(*gotOptions.StartAt); got != 5*time.Minute {
		t.Fatalf("expected 5m freshness window, got %s", got)
	}
}
