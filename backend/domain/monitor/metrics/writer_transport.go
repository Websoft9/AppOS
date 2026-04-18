package metrics

import (
	"context"

	monitortsdb "github.com/websoft9/appos/backend/domain/monitor/metrics/tsdb"
)

type metricWriter interface {
	Write(context.Context, []MetricPoint) error
}

type victoriaMetricsWriter struct {
	service *monitortsdb.Service
}

type noopMetricWriter struct{}

func (noopMetricWriter) Write(_ context.Context, _ []MetricPoint) error {
	return nil
}

func (w *victoriaMetricsWriter) Write(ctx context.Context, points []MetricPoint) error {
	lines := make([]string, 0, len(points))
	for _, point := range points {
		line, err := encodeMetricPoint(point)
		if err != nil {
			return err
		}
		lines = append(lines, line)
	}
	return w.service.WritePrometheusImport(ctx, lines)
}
