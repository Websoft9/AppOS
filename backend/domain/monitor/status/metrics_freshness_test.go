package status

import (
	"testing"
	"time"

	"github.com/websoft9/appos/backend/domain/monitor"
)

func TestEvaluateMetricsFreshnessFresh(t *testing.T) {
	now := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)
	projection := EvaluateMetricsFreshness(now.Add(-20*time.Second), true, now)

	if projection.Status != monitor.StatusHealthy {
		t.Fatalf("expected healthy status, got %q", projection.Status)
	}
	if projection.State != monitor.MetricsFreshnessFresh {
		t.Fatalf("expected fresh state, got %q", projection.State)
	}
	if projection.ReasonCode != "" {
		t.Fatalf("expected empty reason code for fresh metrics, got %q", projection.ReasonCode)
	}
}

func TestEvaluateMetricsFreshnessStale(t *testing.T) {
	now := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)
	projection := EvaluateMetricsFreshness(now.Add(-monitor.MetricsStaleThreshold-time.Second), true, now)

	if projection.Status != monitor.StatusUnknown {
		t.Fatalf("expected unknown status, got %q", projection.Status)
	}
	if projection.State != monitor.MetricsFreshnessStale {
		t.Fatalf("expected stale state, got %q", projection.State)
	}
	if projection.ReasonCode != "metrics_stale" {
		t.Fatalf("expected metrics_stale reason code, got %q", projection.ReasonCode)
	}
}

func TestEvaluateMetricsFreshnessMissing(t *testing.T) {
	now := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)
	projection := EvaluateMetricsFreshness(time.Time{}, false, now)

	if projection.Status != monitor.StatusUnknown {
		t.Fatalf("expected unknown status, got %q", projection.Status)
	}
	if projection.State != monitor.MetricsFreshnessMissing {
		t.Fatalf("expected missing state, got %q", projection.State)
	}
	if projection.ReasonCode != "metrics_missing" {
		t.Fatalf("expected metrics_missing reason code, got %q", projection.ReasonCode)
	}
}

func TestEvaluateMetricsFreshnessFutureObservedAtClampedToFresh(t *testing.T) {
	now := time.Date(2026, 5, 12, 12, 0, 0, 0, time.UTC)
	projection := EvaluateMetricsFreshness(now.Add(time.Minute), true, now)

	if projection.State != monitor.MetricsFreshnessFresh {
		t.Fatalf("expected future observedAt to be fresh, got %q", projection.State)
	}
}
