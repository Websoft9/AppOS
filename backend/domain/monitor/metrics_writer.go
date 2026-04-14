package monitor

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

var allowedMetricSeries = map[string]struct{}{
	"appos_host_cpu_usage":                 {},
	"appos_host_memory_bytes":              {},
	"appos_container_cpu_usage":            {},
	"appos_container_memory_bytes":         {},
	"appos_platform_cpu_percent":           {},
	"appos_platform_memory_bytes":          {},
	"appos_platform_goroutines":            {},
	"appos_platform_heap_alloc_bytes":      {},
	"appos_platform_uptime_seconds":        {},
	"appos_worker_running":                 {},
	"appos_worker_uptime_seconds":          {},
	"appos_worker_dispatch_age_seconds":    {},
	"appos_scheduler_running":              {},
	"appos_scheduler_tick_age_seconds":     {},
	"appos_scheduler_dispatch_age_seconds": {},
}

type metricWriter interface {
	Write(context.Context, []MetricPoint) error
}

type victoriaMetricsWriter struct {
	url    string
	client *http.Client
}

type noopMetricWriter struct{}

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
		url: strings.TrimRight(baseURL, "/") + "/api/v1/import/prometheus",
		client: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

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
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.url, bytes.NewBufferString(strings.Join(lines, "\n")+"\n"))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "text/plain; charset=utf-8")
	resp, err := w.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("victoriametrics write failed with status %d", resp.StatusCode)
	}
	return nil
}

func encodeMetricPoint(point MetricPoint) (string, error) {
	if err := validateMetricPoint(point); err != nil {
		return "", err
	}
	labels := normalizeMetricLabels(point.Labels)
	keys := make([]string, 0, len(labels))
	for key := range labels {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var builder strings.Builder
	builder.WriteString(point.Series)
	if len(keys) > 0 {
		builder.WriteByte('{')
		for index, key := range keys {
			if index > 0 {
				builder.WriteByte(',')
			}
			builder.WriteString(key)
			builder.WriteString(`="`)
			builder.WriteString(escapeMetricLabelValue(labels[key]))
			builder.WriteByte('"')
		}
		builder.WriteByte('}')
	}
	builder.WriteByte(' ')
	builder.WriteString(formatMetricValue(point.Value))
	builder.WriteByte(' ')
	builder.WriteString(fmt.Sprintf("%d", point.ObservedAt.UTC().UnixMilli()))
	return builder.String(), nil
}

func validateMetricPoint(point MetricPoint) error {
	if _, ok := allowedMetricSeries[point.Series]; !ok {
		return fmt.Errorf("metric series %q is not allowed", point.Series)
	}
	if point.ObservedAt.IsZero() {
		return fmt.Errorf("metric observedAt is required")
	}
	return nil
}

func normalizeMetricLabels(labels map[string]string) map[string]string {
	if len(labels) == 0 {
		return nil
	}
	normalized := make(map[string]string, len(labels))
	for key, value := range labels {
		key = sanitizeMetricIdentifier(key)
		if key == "" {
			continue
		}
		normalized[key] = strings.TrimSpace(value)
	}
	return normalized
}

func sanitizeMetricIdentifier(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	var builder strings.Builder
	for index, r := range value {
		isLetter := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
		isDigit := r >= '0' && r <= '9'
		if r == '_' || isLetter || (index > 0 && isDigit) {
			builder.WriteRune(r)
			continue
		}
		if index == 0 && isDigit {
			builder.WriteByte('_')
			builder.WriteRune(r)
			continue
		}
		builder.WriteByte('_')
	}
	return builder.String()
}

func escapeMetricLabelValue(value string) string {
	replacer := strings.NewReplacer(`\\`, `\\\\`, `"`, `\\"`, "\n", `\\n`)
	return replacer.Replace(value)
}

func formatMetricValue(value float64) string {
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.6f", value), "0"), ".")
}
