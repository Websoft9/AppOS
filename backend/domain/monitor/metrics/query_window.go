package metrics

import (
	"fmt"
	"strings"
	"time"
)

var allowedSeriesWindows = map[string]struct {
	Duration time.Duration
	Step     time.Duration
}{
	"15m": {Duration: 15 * time.Minute, Step: 30 * time.Second},
	"1h":  {Duration: time.Hour, Step: time.Minute},
	"5h":  {Duration: 5 * time.Hour, Step: 5 * time.Minute},
	"6h":  {Duration: 6 * time.Hour, Step: 5 * time.Minute},
	"12h": {Duration: 12 * time.Hour, Step: 10 * time.Minute},
	"1d":  {Duration: 24 * time.Hour, Step: 15 * time.Minute},
	"24h": {Duration: 24 * time.Hour, Step: 15 * time.Minute},
	"7d":  {Duration: 7 * 24 * time.Hour, Step: time.Hour},
}

type metricSeriesWindowSpec struct {
	Label string
	Start time.Time
	End   time.Time
	Step  time.Duration
}

func resolveMetricSeriesWindow(window string, options MetricSeriesQueryOptions, now time.Time) (metricSeriesWindowSpec, error) {
	if options.StartAt != nil || options.EndAt != nil {
		if options.StartAt == nil || options.EndAt == nil {
			return metricSeriesWindowSpec{}, fmt.Errorf("custom range requires both startAt and endAt")
		}
		start := options.StartAt.UTC()
		end := options.EndAt.UTC()
		if !end.After(start) {
			return metricSeriesWindowSpec{}, fmt.Errorf("custom range endAt must be after startAt")
		}
		return metricSeriesWindowSpec{
			Label: "custom",
			Start: start,
			End:   end,
			Step:  stepForSeriesDuration(end.Sub(start)),
		}, nil
	}
	windowSpec, ok := allowedSeriesWindows[window]
	if !ok {
		return metricSeriesWindowSpec{}, fmt.Errorf("window %q is not allowed", window)
	}
	end := alignTimeToStepBoundary(now.UTC(), windowSpec.Step)
	start := end.Add(-windowSpec.Duration)
	return metricSeriesWindowSpec{
		Label: window,
		Start: start,
		End:   end,
		Step:  windowSpec.Step,
	}, nil
}

func alignTimeToStepBoundary(value time.Time, step time.Duration) time.Time {
	if step <= 0 {
		return value
	}
	unix := value.Unix()
	stepSeconds := int64(step / time.Second)
	if stepSeconds <= 0 {
		return value
	}
	return time.Unix((unix/stepSeconds)*stepSeconds, 0).UTC()
}

func stepForSeriesDuration(duration time.Duration) time.Duration {
	switch {
	case duration <= time.Hour:
		return time.Minute
	case duration <= 5*time.Hour:
		return 5 * time.Minute
	case duration <= 12*time.Hour:
		return 10 * time.Minute
	case duration <= 24*time.Hour:
		return 15 * time.Minute
	case duration <= 7*24*time.Hour:
		return time.Hour
	default:
		return 6 * time.Hour
	}
}

func containsRequestedSeries(seriesNames []string, target string) bool {
	for _, name := range seriesNames {
		if name == target {
			return true
		}
	}
	return false
}

func normalizeNetworkInterface(value string, available []string) string {
	value = strings.TrimSpace(value)
	if value == "" || strings.EqualFold(value, allNetworkInterfaces) {
		return allNetworkInterfaces
	}
	for _, item := range available {
		if item == value {
			return value
		}
	}
	return allNetworkInterfaces
}

func normalizeRequestedSeries(seriesNames []string) []string {
	if len(seriesNames) == 0 {
		return []string{"cpu", "memory"}
	}
	seen := map[string]struct{}{}
	normalized := make([]string, 0, len(seriesNames))
	for _, name := range seriesNames {
		for _, part := range strings.Split(name, ",") {
			part = strings.ToLower(strings.TrimSpace(part))
			if part == "" {
				continue
			}
			if _, ok := seen[part]; ok {
				continue
			}
			seen[part] = struct{}{}
			normalized = append(normalized, part)
		}
	}
	return normalized
}

// ResolveMetricSeriesWindowForTest exposes fixed-window resolution to external tests.
func ResolveMetricSeriesWindowForTest(window string, options MetricSeriesQueryOptions, now time.Time) (time.Time, time.Time, time.Duration, error) {
	spec, err := resolveMetricSeriesWindow(window, options, now)
	if err != nil {
		return time.Time{}, time.Time{}, 0, err
	}
	return spec.Start, spec.End, spec.Step, nil
}
