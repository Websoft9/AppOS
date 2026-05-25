package metrics

import (
	"context"
	"fmt"
	"time"

	monitortsdb "github.com/websoft9/appos/backend/domain/monitor/metrics/tsdb"
)

type metricSeriesBuilder func(context.Context, *monitortsdb.Service, string, string, string, time.Time, time.Time, time.Duration) (MetricSeries, error)

var specialSeriesBuilders = map[string]metricSeriesBuilder{
	"cpu": func(ctx context.Context, service *monitortsdb.Service, targetType, targetID, _ string, start, end time.Time, step time.Duration) (MetricSeries, error) {
		return buildCPUSeries(ctx, service, targetType, targetID, start, end, step)
	},
	"memory": func(ctx context.Context, service *monitortsdb.Service, targetType, targetID, _ string, start, end time.Time, step time.Duration) (MetricSeries, error) {
		return buildMemorySeries(ctx, service, targetType, targetID, start, end, step)
	},
	"disk": func(ctx context.Context, service *monitortsdb.Service, targetType, targetID, _ string, start, end time.Time, step time.Duration) (MetricSeries, error) {
		return buildDiskSeries(ctx, service, targetType, targetID, start, end, step)
	},
	"disk_usage": func(ctx context.Context, service *monitortsdb.Service, targetType, targetID, _ string, start, end time.Time, step time.Duration) (MetricSeries, error) {
		return buildDiskUsageSeries(ctx, service, targetType, targetID, start, end, step)
	},
	"network": func(ctx context.Context, service *monitortsdb.Service, targetType, targetID, selectedInterface string, start, end time.Time, step time.Duration) (MetricSeries, error) {
		return buildNetworkSeries(ctx, service, targetType, targetID, selectedInterface, start, end, step)
	},
	"network_traffic": func(ctx context.Context, service *monitortsdb.Service, targetType, targetID, selectedInterface string, start, end time.Time, step time.Duration) (MetricSeries, error) {
		return buildNetworkTrafficSeries(ctx, service, targetType, targetID, selectedInterface, start, end, step)
	},
}

func buildSpecialMetricSeries(requested string, ctx context.Context, service *monitortsdb.Service, targetType, targetID, selectedInterface string, start, end time.Time, step time.Duration) (MetricSeries, bool, error) {
	builder, ok := specialSeriesBuilders[requested]
	if !ok {
		return MetricSeries{}, false, nil
	}
	if !isAppOSCorePlatformTarget(targetType, targetID) && targetType != targetTypeServer {
		return MetricSeries{}, false, nil
	}
	series, err := builder(ctx, service, targetType, targetID, selectedInterface, start, end, step)
	if err != nil {
		return MetricSeries{}, true, err
	}
	return series, true, nil
}

func buildCPUSeries(ctx context.Context, service *monitortsdb.Service, targetType, targetID string, start, end time.Time, step time.Duration) (MetricSeries, error) {
	if targetType != targetTypeServer && !isAppOSCorePlatformTarget(targetType, targetID) {
		return MetricSeries{}, fmt.Errorf("cpu special series is unsupported for target type %q", targetType)
	}
	metricTargetType := targetTypeServer
	metricSeries := "appos_host_cpu_usage"
	if isAppOSCorePlatformTarget(targetType, targetID) {
		metricTargetType = targetTypePlatform
		metricSeries = "appos_platform_cpu_percent"
	}
	points, err := executeVMQueryRange(
		ctx,
		service,
		fmt.Sprintf(`%s{target_type=%q,target_id=%q}`, metricSeries, metricTargetType, targetID),
		start,
		end,
		step,
	)
	if err != nil {
		return MetricSeries{}, err
	}
	return MetricSeries{Name: "cpu", Unit: "percent", Points: points}, nil
}

func buildMemorySeries(ctx context.Context, service *monitortsdb.Service, targetType, targetID string, start, end time.Time, step time.Duration) (MetricSeries, error) {
	if targetType != targetTypeServer && !isAppOSCorePlatformTarget(targetType, targetID) {
		return MetricSeries{}, fmt.Errorf("memory special series is unsupported for target type %q", targetType)
	}
	metricTargetType := targetTypeServer
	usedMetric := "appos_host_memory_bytes"
	availableMetric := "appos_host_memory_available_bytes"
	if isAppOSCorePlatformTarget(targetType, targetID) {
		metricTargetType = targetTypePlatform
		usedMetric = "appos_platform_memory_bytes"
		availableMetric = "appos_platform_memory_available_bytes"
	}
	usedPoints, err := executeVMQueryRange(
		ctx,
		service,
		fmt.Sprintf(`sum(%s{target_type=%q,target_id=%q})`, usedMetric, metricTargetType, targetID),
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
		fmt.Sprintf(`sum(%s{target_type=%q,target_id=%q})`, availableMetric, metricTargetType, targetID),
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

func buildDiskSeries(ctx context.Context, service *monitortsdb.Service, targetType, targetID string, start, end time.Time, step time.Duration) (MetricSeries, error) {
	targetMetricType := targetType
	readMetric := "appos_host_disk_read_bytes_per_second"
	writeMetric := "appos_host_disk_write_bytes_per_second"
	if isAppOSCorePlatformTarget(targetType, targetID) {
		targetMetricType = targetTypePlatform
		readMetric = "appos_platform_disk_read_bytes_per_second"
		writeMetric = "appos_platform_disk_write_bytes_per_second"
	}
	readPoints, err := executeVMQueryRange(
		ctx,
		service,
		fmt.Sprintf(`sum(%s{target_type=%q,target_id=%q})`, readMetric, targetMetricType, targetID),
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
		fmt.Sprintf(`sum(%s{target_type=%q,target_id=%q})`, writeMetric, targetMetricType, targetID),
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

func buildDiskUsageSeries(ctx context.Context, service *monitortsdb.Service, targetType, targetID string, start, end time.Time, step time.Duration) (MetricSeries, error) {
	targetMetricType := targetType
	usedMetric := "appos_host_disk_usage_bytes"
	freeMetric := "appos_host_disk_free_bytes"
	if isAppOSCorePlatformTarget(targetType, targetID) {
		targetMetricType = targetTypePlatform
		usedMetric = "appos_platform_disk_usage_bytes"
		freeMetric = "appos_platform_disk_free_bytes"
	}
	usedPoints, err := executeVMQueryRange(
		ctx,
		service,
		fmt.Sprintf(`sum(%s{target_type=%q,target_id=%q})`, usedMetric, targetMetricType, targetID),
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
		fmt.Sprintf(`sum(%s{target_type=%q,target_id=%q})`, freeMetric, targetMetricType, targetID),
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
