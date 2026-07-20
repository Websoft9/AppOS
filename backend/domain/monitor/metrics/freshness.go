package metrics

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/websoft9/appos/backend/domain/monitor"
)

const defaultMetricsFreshnessWindow = 5 * time.Minute

type MetricsFreshnessObservation struct {
	ObservedAt time.Time
	HasSample  bool
}

func QueryServerMetricsFreshness(ctx context.Context, serverID string, now time.Time) (MetricsFreshnessObservation, error) {
	return QueryServerMetricsFreshnessWithin(ctx, serverID, now, defaultMetricsFreshnessWindow)
}

func QueryServerMetricsFreshnessWithin(ctx context.Context, serverID string, now time.Time, lookback time.Duration) (MetricsFreshnessObservation, error) {
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return MetricsFreshnessObservation{}, fmt.Errorf("server id is required")
	}
	now = now.UTC()
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if lookback <= 0 {
		lookback = defaultMetricsFreshnessWindow
	}
	startAt := now.Add(-lookback)
	windowLabel := formatFreshnessWindowLabel(lookback)
	response, err := QueryMetricSeries(ctx, monitor.TargetTypeServer, serverID, windowLabel, []string{"cpu"}, MetricSeriesQueryOptions{StartAt: &startAt, EndAt: &now})
	if err != nil {
		return MetricsFreshnessObservation{}, err
	}
	latest := time.Time{}
	for _, series := range response.Series {
		if observedAt, ok := latestPointTime(series.Points); ok && observedAt.After(latest) {
			latest = observedAt
		}
		for _, segment := range series.Segments {
			if observedAt, ok := latestPointTime(segment.Points); ok && observedAt.After(latest) {
				latest = observedAt
			}
		}
	}
	if latest.IsZero() {
		return MetricsFreshnessObservation{HasSample: false}, nil
	}
	return MetricsFreshnessObservation{ObservedAt: latest.UTC(), HasSample: true}, nil
}

func formatFreshnessWindowLabel(lookback time.Duration) string {
	seconds := int(lookback / time.Second)
	if seconds <= 0 {
		return "custom"
	}
	return fmt.Sprintf("%ds", seconds)
}

func latestPointTime(points [][]float64) (time.Time, bool) {
	if len(points) == 0 {
		return time.Time{}, false
	}
	for i := len(points) - 1; i >= 0; i-- {
		point := points[i]
		if len(point) < 2 {
			continue
		}
		return time.Unix(int64(point[0]), 0).UTC(), true
	}
	return time.Time{}, false
}
