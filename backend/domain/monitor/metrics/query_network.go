package metrics

import (
	"context"
	"math"
	"time"

	monitortsdb "github.com/websoft9/appos/backend/domain/monitor/metrics/tsdb"
)

func buildNetworkSeries(ctx context.Context, service *monitortsdb.Service, targetID, selectedInterface string, start, end time.Time, step time.Duration) (MetricSeries, error) {
	receivedQuery, sentQuery, metadata := monitortsdb.BuildNetworkQueries(targetID, selectedInterface)
	receivedPoints, err := executeVMQueryRange(ctx, service, receivedQuery, start, end, step)
	if err != nil {
		return MetricSeries{}, err
	}
	sentPoints, err := executeVMQueryRange(ctx, service, sentQuery, start, end, step)
	if err != nil {
		return MetricSeries{}, err
	}
	sentPoints = absolutePoints(sentPoints)
	return MetricSeries{
		Name: "network",
		Unit: "bytes/s",
		Segments: []MetricSeriesSegment{
			{Name: "in", Points: receivedPoints},
			{Name: "out", Points: sentPoints},
		},
		Metadata: metadata,
	}, nil
}

func buildNetworkTrafficSeries(ctx context.Context, service *monitortsdb.Service, targetID, selectedInterface string, start, end time.Time, step time.Duration) (MetricSeries, error) {
	receivedQuery, sentQuery, metadata := monitortsdb.BuildNetworkQueries(targetID, selectedInterface)
	receivedPoints, err := executeVMQueryRange(ctx, service, receivedQuery, start, end, step)
	if err != nil {
		return MetricSeries{}, err
	}
	sentPoints, err := executeVMQueryRange(ctx, service, sentQuery, start, end, step)
	if err != nil {
		return MetricSeries{}, err
	}
	sentPoints = absolutePoints(sentPoints)
	scale := float64(step) / float64(time.Second)
	receivedPoints = monitortsdb.ScalePoints(receivedPoints, scale)
	sentPoints = monitortsdb.ScalePoints(sentPoints, scale)
	return MetricSeries{
		Name: "network_traffic",
		Unit: "bytes",
		Segments: []MetricSeriesSegment{
			{Name: "in", Points: receivedPoints},
			{Name: "out", Points: sentPoints},
		},
		Metadata: metadata,
	}, nil
}

func absolutePoints(points [][]float64) [][]float64 {
	normalized := make([][]float64, 0, len(points))
	for _, point := range points {
		if len(point) < 2 {
			continue
		}
		normalized = append(normalized, []float64{point[0], math.Abs(point[1])})
	}
	return normalized
}
