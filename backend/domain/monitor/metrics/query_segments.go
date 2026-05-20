package metrics

import (
	"context"
	"fmt"
	"time"

	monitortsdb "github.com/websoft9/appos/backend/domain/monitor/metrics/tsdb"
)

type metricSeriesBuilder func(context.Context, *monitortsdb.Service, string, string, time.Time, time.Time, time.Duration) (MetricSeries, error)

var specialSeriesBuilders = map[string]metricSeriesBuilder{
	"cpu": func(ctx context.Context, service *monitortsdb.Service, targetID, _ string, start, end time.Time, step time.Duration) (MetricSeries, error) {
		return buildCPUSeries(ctx, service, targetID, start, end, step)
	},
	"memory": func(ctx context.Context, service *monitortsdb.Service, targetID, _ string, start, end time.Time, step time.Duration) (MetricSeries, error) {
		return buildMemorySeries(ctx, service, targetID, start, end, step)
	},
	"disk": func(ctx context.Context, service *monitortsdb.Service, targetID, _ string, start, end time.Time, step time.Duration) (MetricSeries, error) {
		return buildDiskSeries(ctx, service, targetID, start, end, step)
	},
	"disk_usage": func(ctx context.Context, service *monitortsdb.Service, targetID, _ string, start, end time.Time, step time.Duration) (MetricSeries, error) {
		return buildDiskUsageSeries(ctx, service, targetID, start, end, step)
	},
	"network": func(ctx context.Context, service *monitortsdb.Service, targetID, selectedInterface string, start, end time.Time, step time.Duration) (MetricSeries, error) {
		return buildNetworkSeries(ctx, service, targetID, selectedInterface, start, end, step)
	},
	"network_traffic": func(ctx context.Context, service *monitortsdb.Service, targetID, selectedInterface string, start, end time.Time, step time.Duration) (MetricSeries, error) {
		return buildNetworkTrafficSeries(ctx, service, targetID, selectedInterface, start, end, step)
	},
}

func buildSpecialMetricSeries(requested string, ctx context.Context, service *monitortsdb.Service, targetType, targetID, selectedInterface string, start, end time.Time, step time.Duration) (MetricSeries, bool, error) {
	builder, ok := specialSeriesBuilders[requested]
	if !ok {
		return MetricSeries{}, false, nil
	}
	if !isNetdataPlatformTarget(targetType, targetID) && targetType != targetTypeServer {
		return MetricSeries{}, false, nil
	}
	series, err := builder(ctx, service, targetID, selectedInterface, start, end, step)
	if err != nil {
		return MetricSeries{}, true, err
	}
	return series, true, nil
}

func buildCPUSeries(ctx context.Context, service *monitortsdb.Service, targetID string, start, end time.Time, step time.Duration) (MetricSeries, error) {
	points, err := executeVMQueryRange(
		ctx,
		service,
		fmt.Sprintf(`appos_host_cpu_usage{target_type="server",target_id=%q}`, targetID),
		start,
		end,
		step,
	)
	if err != nil {
		return MetricSeries{}, err
	}
	return MetricSeries{Name: "cpu", Unit: "percent", Points: points}, nil
}

func buildMemorySeries(ctx context.Context, service *monitortsdb.Service, targetID string, start, end time.Time, step time.Duration) (MetricSeries, error) {
	usedPoints, err := executeVMQueryRange(
		ctx,
		service,
		fmt.Sprintf(`sum(appos_host_memory_bytes{target_type="server",target_id=%q})`, targetID),
		start,
		end,
		step,
	)
	if err != nil {
		return MetricSeries{}, err
	}
	availablePoints, err := executeVMQueryRange(
		ctx,
		service,
		fmt.Sprintf(`sum(appos_host_memory_available_bytes{target_type="server",target_id=%q})`, targetID),
		start,
		end,
		step,
	)
	if err != nil {
		return MetricSeries{}, err
	}
	return MetricSeries{
		Name: "memory",
		Unit: "bytes",
		Segments: []MetricSeriesSegment{
			{Name: "used", Points: usedPoints},
			{Name: "available", Points: availablePoints},
		},
	}, nil
}

func buildDiskSeries(ctx context.Context, service *monitortsdb.Service, targetID string, start, end time.Time, step time.Duration) (MetricSeries, error) {
	readPoints, err := executeVMQueryRange(
		ctx,
		service,
		fmt.Sprintf(`sum(appos_host_disk_read_bytes_per_second{target_type="server",target_id=%q})`, targetID),
		start,
		end,
		step,
	)
	if err != nil {
		return MetricSeries{}, err
	}
	writePoints, err := executeVMQueryRange(
		ctx,
		service,
		fmt.Sprintf(`sum(appos_host_disk_write_bytes_per_second{target_type="server",target_id=%q})`, targetID),
		start,
		end,
		step,
	)
	if err != nil {
		return MetricSeries{}, err
	}
	return MetricSeries{
		Name: "disk",
		Unit: "bytes/s",
		Segments: []MetricSeriesSegment{
			{Name: "read", Points: readPoints},
			{Name: "write", Points: writePoints},
		},
	}, nil
}

func buildDiskUsageSeries(ctx context.Context, service *monitortsdb.Service, targetID string, start, end time.Time, step time.Duration) (MetricSeries, error) {
	usedPoints, err := executeVMQueryRange(
		ctx,
		service,
		fmt.Sprintf(`sum(appos_host_disk_usage_bytes{target_type="server",target_id=%q})`, targetID),
		start,
		end,
		step,
	)
	if err != nil {
		return MetricSeries{}, err
	}
	freePoints, err := executeVMQueryRange(
		ctx,
		service,
		fmt.Sprintf(`sum(appos_host_disk_free_bytes{target_type="server",target_id=%q})`, targetID),
		start,
		end,
		step,
	)
	if err != nil {
		return MetricSeries{}, err
	}
	return MetricSeries{
		Name: "disk_usage",
		Unit: "bytes",
		Segments: []MetricSeriesSegment{
			{Name: "used", Points: usedPoints},
			{Name: "free", Points: freePoints},
		},
	}, nil
}
