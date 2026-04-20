package status

import (
	"testing"
	"time"

	"github.com/websoft9/appos/backend/domain/monitor"
)

func mustServerHeartbeatEntry(t *testing.T) monitor.TargetRegistryEntry {
	t.Helper()
	entry, ok, err := monitor.ResolveTargetRegistryEntry(monitor.TargetTypeServer, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected server heartbeat registry entry")
	}
	return entry
}

func TestEvaluateHeartbeatFresh(t *testing.T) {
	now := time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC)
	observedAt := now.Add(-20 * time.Second) // well within StaleHeartbeatThreshold (90s)

	proj := EvaluateHeartbeat(mustServerHeartbeatEntry(t), observedAt, now)

	if proj.Status != monitor.StatusHealthy {
		t.Errorf("fresh heartbeat: expected status %q, got %q", monitor.StatusHealthy, proj.Status)
	}
	if proj.HeartbeatState != monitor.HeartbeatStateFresh {
		t.Errorf("fresh heartbeat: expected state %q, got %q", monitor.HeartbeatStateFresh, proj.HeartbeatState)
	}
	if proj.Reason != "" {
		t.Errorf("fresh heartbeat: expected empty reason, got %q", proj.Reason)
	}
}

func TestEvaluateHeartbeatStale(t *testing.T) {
	now := time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC)
	// Between StaleHeartbeatThreshold (90s) and OfflineHeartbeatThreshold (180s)
	observedAt := now.Add(-120 * time.Second)

	proj := EvaluateHeartbeat(mustServerHeartbeatEntry(t), observedAt, now)

	if proj.Status != monitor.StatusUnknown {
		t.Errorf("stale heartbeat: expected status %q, got %q", monitor.StatusUnknown, proj.Status)
	}
	if proj.HeartbeatState != monitor.HeartbeatStateStale {
		t.Errorf("stale heartbeat: expected state %q, got %q", monitor.HeartbeatStateStale, proj.HeartbeatState)
	}
	if proj.ReasonCode != "heartbeat_stale" {
		t.Errorf("stale heartbeat: expected reason_code %q, got %q", "heartbeat_stale", proj.ReasonCode)
	}
}

func TestEvaluateHeartbeatOffline(t *testing.T) {
	now := time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC)
	observedAt := now.Add(-300 * time.Second) // beyond OfflineHeartbeatThreshold (180s)

	proj := EvaluateHeartbeat(mustServerHeartbeatEntry(t), observedAt, now)

	if proj.Status != monitor.StatusOffline {
		t.Errorf("offline heartbeat: expected status %q, got %q", monitor.StatusOffline, proj.Status)
	}
	if proj.HeartbeatState != monitor.HeartbeatStateOffline {
		t.Errorf("offline heartbeat: expected state %q, got %q", monitor.HeartbeatStateOffline, proj.HeartbeatState)
	}
	if proj.ReasonCode != "heartbeat_missing" {
		t.Errorf("offline heartbeat: expected reason_code %q, got %q", "heartbeat_missing", proj.ReasonCode)
	}
}

func TestEvaluateHeartbeatFutureObservedAtClampedToZero(t *testing.T) {
	now := time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC)
	// observedAt in the future (clock skew) should be treated as age=0 → fresh
	observedAt := now.Add(60 * time.Second)

	proj := EvaluateHeartbeat(mustServerHeartbeatEntry(t), observedAt, now)

	if proj.HeartbeatState != monitor.HeartbeatStateFresh {
		t.Errorf("future observedAt: expected fresh state, got %q", proj.HeartbeatState)
	}
}

func TestEvaluateHeartbeatExactThresholds(t *testing.T) {
	now := time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC)

	// Exactly at StaleHeartbeatThreshold (90s): age > threshold is false → still fresh
	atStale := now.Add(-monitor.StaleHeartbeatThreshold)
	entry := mustServerHeartbeatEntry(t)
	proj := EvaluateHeartbeat(entry, atStale, now)
	if proj.HeartbeatState != monitor.HeartbeatStateFresh {
		t.Errorf("at stale threshold: expected fresh (exclusive >), got %q", proj.HeartbeatState)
	}

	// One nanosecond past StaleHeartbeatThreshold → stale
	justPastStale := now.Add(-monitor.StaleHeartbeatThreshold - time.Nanosecond)
	proj = EvaluateHeartbeat(entry, justPastStale, now)
	if proj.HeartbeatState != monitor.HeartbeatStateStale {
		t.Errorf("just past stale threshold: expected stale, got %q", proj.HeartbeatState)
	}

	// Exactly at OfflineHeartbeatThreshold (180s): age > threshold is false → still stale
	atOffline := now.Add(-monitor.OfflineHeartbeatThreshold)
	proj = EvaluateHeartbeat(entry, atOffline, now)
	if proj.HeartbeatState != monitor.HeartbeatStateStale {
		t.Errorf("at offline threshold: expected stale (exclusive >), got %q", proj.HeartbeatState)
	}

	// One nanosecond past OfflineHeartbeatThreshold → offline
	justPastOffline := now.Add(-monitor.OfflineHeartbeatThreshold - time.Nanosecond)
	proj = EvaluateHeartbeat(entry, justPastOffline, now)
	if proj.HeartbeatState != monitor.HeartbeatStateOffline {
		t.Errorf("just past offline threshold: expected offline, got %q", proj.HeartbeatState)
	}
}

func TestEvaluateHeartbeatUsesRegistryHeartbeatPolicy(t *testing.T) {
	now := time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC)
	observedAt := now.Add(-120 * time.Second)
	entry := monitor.TargetRegistryEntry{
		Checks: monitor.TargetCheckPolicies{
			Heartbeat: &monitor.HeartbeatTargetPolicy{
				StatusMap: map[string]string{
					monitor.HeartbeatStateStale: monitor.StatusDegraded,
				},
				ReasonMap: map[string]string{
					monitor.HeartbeatStateStale: "custom stale mapping",
				},
				ReasonCodeMap: map[string]string{
					monitor.HeartbeatStateStale: "custom_heartbeat_stale",
				},
			},
		},
	}

	proj := EvaluateHeartbeat(entry, observedAt, now)
	if proj.Status != monitor.StatusDegraded {
		t.Fatalf("expected stale heartbeat to use registry status mapping, got %q", proj.Status)
	}
	if proj.Reason != "custom stale mapping" {
		t.Fatalf("expected stale heartbeat to use registry reason mapping, got %q", proj.Reason)
	}
	if proj.ReasonCode != "custom_heartbeat_stale" {
		t.Fatalf("expected stale heartbeat to use registry reason code mapping, got %q", proj.ReasonCode)
	}
}
