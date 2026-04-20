package store_test

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/monitor/status/store"
	"github.com/websoft9/appos/backend/infra/collections"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func TestApplyReasonCodeNormalizesAndClears(t *testing.T) {
	summary := map[string]any{"reason_code": "old_value"}
	store.ApplyReasonCode(summary, "  HEARTBEAT_STALE  ")
	if got := summary["reason_code"]; got != "heartbeat_stale" {
		t.Fatalf("expected normalized reason_code heartbeat_stale, got %+v", got)
	}
	store.ApplyReasonCode(summary, "   ")
	if _, ok := summary["reason_code"]; ok {
		t.Fatalf("expected empty reason code to clear field, got %+v", summary)
	}
}

func TestLoadResourceCheckSummaryMergesExistingSummary(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	_, err = store.UpsertLatestStatus(app, store.LatestStatusUpsert{
		TargetType:       monitor.TargetTypeResource,
		TargetID:         "inst-1",
		DisplayName:      "redis-primary",
		Status:           monitor.StatusHealthy,
		SignalSource:     monitor.SignalSourceAppOS,
		LastTransitionAt: time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC),
		Summary:          map[string]any{"existing": "value"},
	})
	if err != nil {
		t.Fatal(err)
	}

	summary := store.LoadResourceCheckSummary(app, monitor.TargetTypeResource, "inst-1", monitor.CheckKindReachability, "resource-redis-generic", "redis", "generic-redis", "127.0.0.1:6379")
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
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
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

func TestSummaryFromRecordInvalidJSONReturnsError(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	col, err := app.FindCollectionByNameOrId(collections.MonitorLatestStatus)
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(col)
	record.Set("target_type", monitor.TargetTypeResource)
	record.Set("target_id", "inst-3")
	record.Set("summary_json", "{not-json")
	if _, err := store.SummaryFromRecord(record); err == nil {
		t.Fatal("expected invalid summary_json to return an error")
	}
}

func TestPreviousFailureCountAndHasDifferentCheckKind(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

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
