package projection

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/internal/lifecycle/model"

	_ "github.com/websoft9/appos/backend/internal/migrations"
)

func TestApplyOperationQueuedForNewInstall(t *testing.T) {
	app := newProjectionTestApp(t)
	defer app.Cleanup()

	appRecord := createTestAppInstance(t, app)
	operationRecord := createTestOperation(t, app, appRecord, string(model.OperationTypeInstall))

	ApplyOperationQueued(appRecord, operationRecord, QueueOptions{ExistingApp: false})
	if err := app.Save(appRecord); err != nil {
		t.Fatal(err)
	}

	if got := appRecord.GetString("last_operation"); got != operationRecord.Id {
		t.Fatalf("expected last_operation %q, got %q", operationRecord.Id, got)
	}
	if got := appRecord.GetString("lifecycle_state"); got != string(model.AppStateInstalling) {
		t.Fatalf("expected lifecycle_state installing, got %q", got)
	}
	if got := appRecord.GetString("state_reason"); got != "operation queued" {
		t.Fatalf("expected queued state_reason, got %q", got)
	}
}

func TestApplyOperationSucceededForInstall(t *testing.T) {
	app := newProjectionTestApp(t)
	defer app.Cleanup()

	appRecord := createTestAppInstance(t, app)
	operationRecord := createTestOperation(t, app, appRecord, string(model.OperationTypeInstall))
	now := time.Date(2026, time.March, 24, 10, 0, 0, 0, time.UTC)

	ApplyOperationSucceeded(appRecord, operationRecord, now)
	if err := app.Save(appRecord); err != nil {
		t.Fatal(err)
	}

	if got := appRecord.GetString("last_operation"); got != operationRecord.Id {
		t.Fatalf("expected last_operation %q, got %q", operationRecord.Id, got)
	}
	if got := appRecord.GetString("lifecycle_state"); got != string(model.AppStateRunningHealthy) {
		t.Fatalf("expected lifecycle_state running_healthy, got %q", got)
	}
	if got := appRecord.GetString("health_summary"); got != string(model.HealthHealthy) {
		t.Fatalf("expected health_summary healthy, got %q", got)
	}
	if got := appRecord.GetString("state_reason"); got != "operation completed" {
		t.Fatalf("expected completed state_reason, got %q", got)
	}
	if got := appRecord.GetDateTime("installed_at").String(); got == "" {
		t.Fatal("expected installed_at to be populated")
	}
}

func TestApplyOperationFailedMarksAttentionRequired(t *testing.T) {
	app := newProjectionTestApp(t)
	defer app.Cleanup()

	appRecord := createTestAppInstance(t, app)
	appRecord.Set("lifecycle_state", string(model.AppStateUpdating))
	appRecord.Set("health_summary", string(model.HealthHealthy))
	if err := app.Save(appRecord); err != nil {
		t.Fatal(err)
	}

	operationRecord := createTestOperation(t, app, appRecord, string(model.OperationTypeUpgrade))
	operationRecord.Set("failure_reason", "verification_failed")
	operationRecord.Set("error_message", "probe failed")
	if err := app.Save(operationRecord); err != nil {
		t.Fatal(err)
	}

	ApplyOperationFailed(appRecord, operationRecord)
	if err := app.Save(appRecord); err != nil {
		t.Fatal(err)
	}

	if got := appRecord.GetString("last_operation"); got != operationRecord.Id {
		t.Fatalf("expected last_operation %q, got %q", operationRecord.Id, got)
	}
	if got := appRecord.GetString("lifecycle_state"); got != string(model.AppStateAttentionRequired) {
		t.Fatalf("expected lifecycle_state attention_required, got %q", got)
	}
	if got := appRecord.GetString("state_reason"); got != "probe failed" {
		t.Fatalf("expected state_reason from error_message, got %q", got)
	}
	if got := appRecord.GetString("health_summary"); got != string(model.HealthHealthy) {
		t.Fatalf("expected health_summary to remain healthy, got %q", got)
	}
}

func TestReadAndApplyAppInstanceProjection(t *testing.T) {
	app := newProjectionTestApp(t)
	defer app.Cleanup()

	appRecord := createTestAppInstance(t, app)
	now := time.Date(2026, time.March, 24, 12, 0, 0, 0, time.UTC)
	projection := model.AppInstanceProjection{
		LifecycleState:     model.AppStateRunningHealthy,
		HealthSummary:      model.HealthHealthy,
		PublicationSummary: model.PublicationPublished,
		DesiredState:       model.DesiredStateRunning,
		StateReason:        "projection applied",
		LastOperationID:    "op-1",
		CurrentReleaseID:   "rel-1",
		PrimaryExposureID:  "exp-1",
		InstalledAt:        &now,
	}

	ApplyAppInstanceProjection(appRecord, projection)

	loaded := ReadAppInstanceProjection(appRecord)
	if loaded.LifecycleState != model.AppStateRunningHealthy {
		t.Fatalf("expected lifecycle_state %q, got %q", model.AppStateRunningHealthy, loaded.LifecycleState)
	}
	if loaded.HealthSummary != model.HealthHealthy {
		t.Fatalf("expected health_summary %q, got %q", model.HealthHealthy, loaded.HealthSummary)
	}
	if loaded.PublicationSummary != model.PublicationPublished {
		t.Fatalf("expected publication_summary %q, got %q", model.PublicationPublished, loaded.PublicationSummary)
	}
	if loaded.StateReason != "projection applied" {
		t.Fatalf("expected state_reason to round-trip, got %q", loaded.StateReason)
	}
	if loaded.LastOperationID != "op-1" {
		t.Fatalf("expected last_operation to round-trip, got %q", loaded.LastOperationID)
	}
	if loaded.InstalledAt == nil || !loaded.InstalledAt.Equal(now) {
		t.Fatal("expected installed_at to round-trip")
	}
}

func newProjectionTestApp(t *testing.T) *tests.TestApp {
	t.Helper()

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}

	return app
}

func createTestAppInstance(t *testing.T, app core.App) *core.Record {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("app_instances")
	if err != nil {
		t.Fatal(err)
	}

	record := core.NewRecord(collection)
	record.Set("key", "test-app")
	record.Set("name", "test-app")
	record.Set("server_id", "server-1")
	record.Set("lifecycle_state", string(model.AppStateRegistered))
	record.Set("desired_state", string(model.DesiredStateRunning))
	record.Set("health_summary", string(model.HealthUnknown))
	record.Set("publication_summary", string(model.PublicationUnpublished))
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}

	return record
}

func createTestOperation(t *testing.T, app core.App, appRecord *core.Record, operationType string) *core.Record {
	t.Helper()

	collection, err := app.FindCollectionByNameOrId("app_operations")
	if err != nil {
		t.Fatal(err)
	}

	record := core.NewRecord(collection)
	record.Set("app", appRecord.Id)
	record.Set("server_id", appRecord.GetString("server_id"))
	record.Set("operation_type", operationType)
	record.Set("trigger_source", string(model.TriggerSourceManualOps))
	record.Set("phase", string(model.OperationPhaseQueued))
	record.Set("queued_at", time.Now())
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}

	return record
}
