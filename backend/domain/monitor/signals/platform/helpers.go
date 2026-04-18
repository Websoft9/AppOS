package platform

import (
	"time"

	"github.com/websoft9/appos/backend/domain/monitor"
)

func formatTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value.UTC().Format(time.RFC3339)
}

func formatUnixNano(value uint64) any {
	if value == 0 {
		return nil
	}
	return time.Unix(0, int64(value)).UTC().Format(time.RFC3339)
}

func secondsSince(now, value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return secondsSinceFloat(now, value)
}

func secondsSinceFloat(now, value time.Time) float64 {
	if value.IsZero() {
		return 0
	}
	seconds := now.Sub(value).Seconds()
	if seconds < 0 {
		seconds = 0
	}
	return seconds
}

func boolMetric(value bool) float64 {
	if value {
		return 1
	}
	return 0
}

func platformMetricLabels(targetID string) map[string]string {
	return map[string]string{
		"target_type": monitor.TargetTypePlatform,
		"target_id":   targetID,
	}
}

func emptyToNil(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
