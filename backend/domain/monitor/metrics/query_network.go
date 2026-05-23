package metrics

import (
	"context"
	"fmt"
	"math"
	"time"

	monitortsdb "github.com/websoft9/appos/backend/domain/monitor/metrics/tsdb"
)

func buildNetworkSeries(ctx context.Context, service *monitortsdb.Service, targetType, targetID, selectedInterface string, start, end time.Time, step time.Duration) (MetricSeries, error) {
	receivedQuery, sentQuery, metadata := buildNetworkQueriesForTarget(targetType, targetID, selectedInterface)
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

func buildNetworkTrafficSeries(ctx context.Context, service *monitortsdb.Service, targetType, targetID, selectedInterface string, start, end time.Time, step time.Duration) (MetricSeries, error) {
	receivedQuery, sentQuery, metadata := buildNetworkQueriesForTarget(targetType, targetID, selectedInterface)
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
	receivedPoints = cumulativePoints(monitortsdb.ScalePoints(receivedPoints, scale))
	sentPoints = cumulativePoints(monitortsdb.ScalePoints(sentPoints, scale))
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

func buildNetworkQueriesForTarget(targetType, targetID, selectedInterface string) (string, string, map[string]string) {
	if isNetdataPlatformTarget(targetType, targetID) {
		selected := selectedInterface
		if selected == "" {
			selected = monitortsdb.AllNetworkInterfaces
		}
		receivedQuery := fmt.Sprintf(`sum(appos_platform_network_rx_bytes_per_second{target_type="platform",target_id=%q,network_interface=""})`, targetID)
		sentQuery := fmt.Sprintf(`sum(appos_platform_network_tx_bytes_per_second{target_type="platform",target_id=%q,network_interface=""})`, targetID)
		metadata := map[string]string(nil)
		if selected != monitortsdb.AllNetworkInterfaces {
			receivedQuery = fmt.Sprintf(`sum(appos_platform_network_rx_bytes_per_second{target_type="platform",target_id=%q,network_interface=%q})`, targetID, selected)
			sentQuery = fmt.Sprintf(`sum(appos_platform_network_tx_bytes_per_second{target_type="platform",target_id=%q,network_interface=%q})`, targetID, selected)
			metadata = map[string]string{"network_interface": selected}
		}
		return receivedQuery, sentQuery, metadata
	}
	return monitortsdb.BuildNetworkQueries(targetID, selectedInterface)
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

func cumulativePoints(points [][]float64) [][]float64 {
	accumulated := make([][]float64, 0, len(points))
	total := 0.0
	for _, point := range points {
		if len(point) < 2 {
			continue
		}
		total += point[1]
		accumulated = append(accumulated, []float64{point[0], total})
	}
	return accumulated
}
