package metrics

import (
	"context"
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
	scale := float64(step) / float64(time.Second) / (1024 * 1024 * 1024)
	receivedPoints = monitortsdb.ScalePoints(receivedPoints, scale)
	sentPoints = monitortsdb.ScalePoints(sentPoints, scale)
	return MetricSeries{
		Name: "network_traffic",
		Unit: "GB",
		Segments: []MetricSeriesSegment{
			{Name: "in", Points: receivedPoints},
			{Name: "out", Points: sentPoints},
		},
		Metadata: metadata,
	}, nil
}
