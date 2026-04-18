package metrics

import (
	"context"
	"fmt"
	"time"

	monitortsdb "github.com/websoft9/appos/backend/domain/monitor/metrics/tsdb"
)

type metricSeriesBuilder func(context.Context, *monitortsdb.Service, string, string, time.Time, time.Time, time.Duration) (MetricSeries, error)

var netdataSeriesBuilders = map[string]metricSeriesBuilder{
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

func buildNetdataMetricSeries(requested string, ctx context.Context, service *monitortsdb.Service, targetType, targetID, selectedInterface string, start, end time.Time, step time.Duration) (MetricSeries, bool, error) {
	builder, ok := netdataSeriesBuilders[requested]
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

func buildMemorySeries(ctx context.Context, service *monitortsdb.Service, targetID string, start, end time.Time, step time.Duration) (MetricSeries, error) {
	usedPoints, err := executeVMQueryRange(
		ctx,
		service,
		fmt.Sprintf(`sum(netdata_system_ram_MiB_average{instance=%q,dimension="used"}) * 1048576`, targetID),
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
		fmt.Sprintf(`sum(netdata_system_ram_MiB_average{instance=%q,dimension=~"free|cached|buffers"}) * 1048576`, targetID),
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
		fmt.Sprintf(`sum(netdata_system_io_KiB_persec_average{instance=%q,dimension="reads"}) * 1024`, targetID),
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
		fmt.Sprintf(`sum(netdata_system_io_KiB_persec_average{instance=%q,dimension="writes"}) * 1024`, targetID),
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
		fmt.Sprintf(`sum(netdata_disk_space_GiB_average{instance=%q,family="/",dimension="used"}) * 1073741824`, targetID),
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
		fmt.Sprintf(`sum(netdata_disk_space_GiB_average{instance=%q,family="/",dimension=~"avail|reserved_for_root"}) * 1073741824`, targetID),
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
