package metrics

import (
	"context"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	monitortsdb "github.com/websoft9/appos/backend/domain/monitor/metrics/tsdb"
)

var (
	metricWriteOverrideMu sync.RWMutex
	metricWriteOverride   func(context.Context, []MetricPoint) error
)

func SetMetricWriteFuncForTest(fn func(context.Context, []MetricPoint) error) func() {
	metricWriteOverrideMu.Lock()
	previous := metricWriteOverride
	metricWriteOverride = fn
	metricWriteOverrideMu.Unlock()
	return func() {
		metricWriteOverrideMu.Lock()
		metricWriteOverride = previous
		metricWriteOverrideMu.Unlock()
	}
}

func WriteMetricPoints(ctx context.Context, points []MetricPoint) error {
	if len(points) == 0 {
		return nil
	}
	for _, point := range points {
		if err := validateMetricPoint(point); err != nil {
			return err
		}
	}
	metricWriteOverrideMu.RLock()
	override := metricWriteOverride
	metricWriteOverrideMu.RUnlock()
	if override != nil {
		return override(ctx, points)
	}
	return defaultMetricWriter().Write(ctx, points)
}

func defaultMetricWriter() metricWriter {
	baseURL := strings.TrimSpace(os.Getenv(EnvVictoriaMetricsURL))
	if baseURL == "" {
		return noopMetricWriter{}
	}
	return &victoriaMetricsWriter{
		service: monitortsdb.NewService(&http.Client{
			Timeout: 5 * time.Second,
		}, baseURL),
	}
}
