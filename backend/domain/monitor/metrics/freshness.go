package metrics

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/websoft9/appos/backend/domain/monitor"
)

const defaultMetricsFreshnessWindow = "5m"

type MetricsFreshnessObservation struct {
	ObservedAt time.Time
	HasSample  bool
}

func QueryServerMetricsFreshness(ctx context.Context, serverID string, now time.Time) (MetricsFreshnessObservation, error) {
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return MetricsFreshnessObservation{}, fmt.Errorf("server id is required")
	}
	now = now.UTC()
	if now.IsZero() {
		now = time.Now().UTC()
	}
	response, err := QueryMetricSeries(ctx, monitor.TargetTypeServer, serverID, defaultMetricsFreshnessWindow, []string{"cpu"}, MetricSeriesQueryOptions{EndAt: &now})
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
