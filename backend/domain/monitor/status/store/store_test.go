package store_test

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/monitor/status/store"
	"github.com/websoft9/appos/backend/infra/collections"
)

func TestApplyReasonCodeNormalizesAndClears(t *testing.T) {
	summary := map[string]any{"reason_code": "old_value"}
	store.ApplyReasonCode(summary, "  CONTROL_UNREACHABLE  ")
	if got := summary["reason_code"]; got != "control_unreachable" {
		t.Fatalf("expected normalized reason_code control_unreachable, got %+v", got)
	}
	store.ApplyReasonCode(summary, "   ")
	if _, ok := summary["reason_code"]; ok {
		t.Fatalf("expected empty reason code to clear field, got %+v", summary)
	}
}

func TestLoadResourceCheckSummaryMergesExistingSummary(t *testing.T) {
	summary := store.BuildResourceCheckSummary(
		map[string]any{"existing": "value"},
		monitor.CheckKindReachability,
		"resource-redis-generic",
		"redis",
		"generic-redis",
		"127.0.0.1:6379",
	)
	if summary["existing"] != "value" {
		t.Fatalf("expected existing summary field to be preserved, got %+v", summary)
	}
	if summary["check_kind"] != monitor.CheckKindReachability {
		t.Fatalf("expected check_kind to be set, got %+v", summary)
	}
	if summary["registry_entry_id"] != "resource-redis-generic" {
		t.Fatalf("expected registry_entry_id to be set, got %+v", summary)
	}
	if summary["endpoint"] != "127.0.0.1:6379" {
		t.Fatalf("expected endpoint to be set, got %+v", summary)
	}
}

func TestUpsertLatestStatusPreservesStrongerFailureAndTransition(t *testing.T) {
	app := newStoreTestApp(t)
	defer app.Cleanup()

	initialTransition := time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC)
	record, err := store.UpsertLatestStatus(app, store.LatestStatusUpsert{
		TargetType:       monitor.TargetTypeResource,
		TargetID:         "inst-2",
		DisplayName:      "redis-primary",
		Status:           monitor.StatusOffline,
		Reason:           "offline original",
		SignalSource:     monitor.SignalSourceAppOS,
		LastTransitionAt: initialTransition,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := record.GetString("status"); got != monitor.StatusOffline {
		t.Fatalf("expected initial offline status, got %q", got)
	}

	_, err = store.UpsertLatestStatus(app, store.LatestStatusUpsert{
		TargetType:              monitor.TargetTypeResource,
		TargetID:                "inst-2",
		DisplayName:             "redis-primary",
		Status:                  monitor.StatusUnknown,
		Reason:                  "should be ignored",
		SignalSource:            monitor.SignalSourceAppOS,
		LastTransitionAt:        initialTransition.Add(10 * time.Minute),
		StatusPriorityMap:       map[string]int{"offline": 2, "unknown": 1},
		PreserveStrongerFailure: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	updated := loadStoreLatestStatusRecord(t, app, monitor.TargetTypeResource, "inst-2")
	if got := updated.GetString("status"); got != monitor.StatusOffline {
		t.Fatalf("expected stronger existing offline status to be preserved, got %q", got)
	}
	if got := updated.GetString("reason"); got != "offline original" {
		t.Fatalf("expected original reason to be preserved, got %q", got)
	}
	if got := updated.GetDateTime("last_transition_at").Time(); !got.Equal(initialTransition) {
		t.Fatalf("expected last_transition_at to remain %v, got %v", initialTransition, got)
	}
}

func TestUpsertLatestStatusIncomingCheckKindIgnoresMissingExistingCheckKind(t *testing.T) {
	app := newStoreTestApp(t)
	defer app.Cleanup()

	now := time.Date(2026, 5, 13, 12, 0, 0, 0, time.UTC)
	_, err := store.UpsertLatestStatus(app, store.LatestStatusUpsert{
		TargetType:       monitor.TargetTypeServer,
		TargetID:         "server-missing-check-kind",
		DisplayName:      "server-missing-check-kind",
		Status:           monitor.StatusUnreachable,
		Reason:           "previous failure without check kind",
		SignalSource:     monitor.SignalSourceAppOS,
		LastTransitionAt: now,
		Summary:          map[string]any{"legacy": true},
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = store.UpsertLatestStatus(app, store.LatestStatusUpsert{
		TargetType:        monitor.TargetTypeServer,
		TargetID:          "server-missing-check-kind",
		DisplayName:       "server-missing-check-kind",
		Status:            monitor.StatusHealthy,
		SignalSource:      monitor.SignalSourceAppOS,
		LastTransitionAt:  now.Add(time.Minute),
		StatusPriorityMap: map[string]int{monitor.StatusUnreachable: 4, monitor.StatusHealthy: 0},
		IncomingCheckKind: monitor.CheckKindControlReachability,
		Summary:           map[string]any{"check_kind": monitor.CheckKindControlReachability},
	})
	if err != nil {
		t.Fatal(err)
	}

	updated := loadStoreLatestStatusRecord(t, app, monitor.TargetTypeServer, "server-missing-check-kind")
	if got := updated.GetString("status"); got != monitor.StatusHealthy {
		t.Fatalf("expected missing existing check_kind not to preserve stale failure, got %q", got)
	}
}

func TestCloneSummaryDeepCopiesNestedValues(t *testing.T) {
	original := map[string]any{
		"apps": []map[string]any{{"app_id": "app-1", "runtime_state": "healthy"}},
		"meta": map[string]any{"reason": "ok"},
	}
	cloned := store.CloneSummary(original)

	clonedApps := cloned["apps"].([]map[string]any)
	clonedApps[0]["runtime_state"] = "degraded"
	clonedMeta := cloned["meta"].(map[string]any)
	clonedMeta["reason"] = "changed"

	originalApps := original["apps"].([]map[string]any)
	if originalApps[0]["runtime_state"] != "healthy" {
		t.Fatalf("expected original nested app state unchanged, got %+v", originalApps)
	}
	originalMeta := original["meta"].(map[string]any)
	if originalMeta["reason"] != "ok" {
		t.Fatalf("expected original nested meta unchanged, got %+v", originalMeta)
	}
}

func TestSummaryFromRecordInvalidJSONReturnsError(t *testing.T) {
	col := core.NewBaseCollection(collections.MonitorLatestStatus)
	record := core.NewRecord(col)
	record.Set("target_type", monitor.TargetTypeResource)
	record.Set("target_id", "inst-3")
	record.Set("summary_json", "{not-json")
	if _, err := store.SummaryFromRecord(record); err == nil {
		t.Fatal("expected invalid summary_json to return an error")
	}
}

func TestPreviousFailureCountAndHasDifferentCheckKind(t *testing.T) {
	app := newStoreTestApp(t)
	defer app.Cleanup()
	var err error

	failures := 3
	_, err = store.UpsertLatestStatus(app, store.LatestStatusUpsert{
		TargetType:          monitor.TargetTypeResource,
		TargetID:            "inst-4",
		DisplayName:         "redis-primary",
		Status:              monitor.StatusUnreachable,
		SignalSource:        monitor.SignalSourceAppOS,
		LastTransitionAt:    time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC),
		ConsecutiveFailures: &failures,
		Summary:             map[string]any{"check_kind": monitor.CheckKindCredential},
	})
	if err != nil {
		t.Fatal(err)
	}

	if got := store.PreviousFailureCount(app, monitor.TargetTypeResource, "inst-4"); got != 3 {
		t.Fatalf("expected previous failure count 3, got %d", got)
	}
	if !store.HasDifferentCheckKind(app, monitor.TargetTypeResource, "inst-4", monitor.CheckKindReachability) {
		t.Fatal("expected different check kind to be detected")
	}
	if store.HasDifferentCheckKind(app, monitor.TargetTypeResource, "inst-4", monitor.CheckKindCredential) {
		t.Fatal("expected same check kind not to be flagged as different")
	}
}

func loadStoreLatestStatusRecord(t *testing.T, app core.App, targetType, targetID string) *core.Record {
	t.Helper()
	record, err := app.FindFirstRecordByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": targetType, "targetID": targetID},
	)
	if err != nil {
		t.Fatal(err)
	}
	return record
}
