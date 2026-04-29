package metrics

import (
	"fmt"
	"sort"
	"strings"

	"github.com/websoft9/appos/backend/domain/monitor"
)

var allowedMetricSeries = map[string]struct{}{
	"appos_host_cpu_usage":                              {},
	"appos_host_memory_bytes":                           {},
	"appos_container_cpu_usage":                         {},
	"appos_container_memory_bytes":                      {},
	"appos_container_network_receive_bytes_per_second":  {},
	"appos_container_network_transmit_bytes_per_second": {},
	"appos_platform_cpu_percent":                        {},
	"appos_platform_memory_bytes":                       {},
	"appos_platform_goroutines":                         {},
	"appos_platform_heap_alloc_bytes":                   {},
	"appos_platform_uptime_seconds":                     {},
	"appos_worker_running":                              {},
	"appos_worker_uptime_seconds":                       {},
	"appos_worker_dispatch_age_seconds":                 {},
	"appos_scheduler_running":                           {},
	"appos_scheduler_tick_age_seconds":                  {},
	"appos_scheduler_dispatch_age_seconds":              {},
}

var containerMetricSeries = map[string]struct{}{
	"appos_container_cpu_usage":                         {},
	"appos_container_memory_bytes":                      {},
	"appos_container_network_receive_bytes_per_second":  {},
	"appos_container_network_transmit_bytes_per_second": {},
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
	if IsContainerMetricSeries(point.Series) {
		serverID := strings.TrimSpace(point.Labels["server_id"])
		containerID := strings.TrimSpace(point.Labels["container_id"])
		targetType := strings.TrimSpace(point.Labels["target_type"])
		targetID := strings.TrimSpace(point.Labels["target_id"])
		if serverID == "" {
			return fmt.Errorf("container metric series %q requires server_id", point.Series)
		}
		if containerID == "" {
			return fmt.Errorf("container metric series %q requires container_id", point.Series)
		}
		if targetType != monitor.TargetTypeContainer {
			return fmt.Errorf("container metric series %q requires target_type %q", point.Series, monitor.TargetTypeContainer)
		}
		if targetID == "" || targetID != containerID {
			return fmt.Errorf("container metric series %q requires target_id to match container_id", point.Series)
		}
	}
	return nil
}

func IsContainerMetricSeries(series string) bool {
	_, ok := containerMetricSeries[strings.TrimSpace(series)]
	return ok
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
