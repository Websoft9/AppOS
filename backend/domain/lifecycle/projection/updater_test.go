package projection

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
)

func TestApplyOperationQueuedForNewInstall(t *testing.T) {
	appRecord := newProjectionAppRecord()
	operationRecord := newProjectionOperationRecord(appRecord, string(model.OperationTypeInstall))

	ApplyOperationQueued(appRecord, operationRecord, QueueOptions{ExistingApp: false})

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
	appRecord := newProjectionAppRecord()
	operationRecord := newProjectionOperationRecord(appRecord, string(model.OperationTypeInstall))
	now := time.Date(2026, time.March, 24, 10, 0, 0, 0, time.UTC)

	ApplyOperationSucceeded(appRecord, operationRecord, now)

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
	appRecord := newProjectionAppRecord()
	appRecord.Set("lifecycle_state", string(model.AppStateUpdating))
	appRecord.Set("health_summary", string(model.HealthHealthy))

	operationRecord := newProjectionOperationRecord(appRecord, string(model.OperationTypeUpgrade))
	operationRecord.Set("failure_reason", "verification_failed")
	operationRecord.Set("error_message", "probe failed")

	ApplyOperationFailed(appRecord, operationRecord)

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
	appRecord := newProjectionAppRecord()
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

func newProjectionAppRecord() *core.Record {
	collection := core.NewBaseCollection("app_instances")
	record := core.NewRecord(collection)
	record.Id = "app-1"
	record.Set("key", "test-app")
	record.Set("name", "test-app")
	record.Set("server_id", "server-1")
	record.Set("lifecycle_state", string(model.AppStateRegistered))
	record.Set("desired_state", string(model.DesiredStateRunning))
	record.Set("health_summary", string(model.HealthUnknown))
	record.Set("publication_summary", string(model.PublicationUnpublished))
	return record
}

func newProjectionOperationRecord(appRecord *core.Record, operationType string) *core.Record {
	collection := core.NewBaseCollection("app_operations")
	record := core.NewRecord(collection)
	record.Id = "op-1"
	record.Set("app", appRecord.Id)
	record.Set("server_id", appRecord.GetString("server_id"))
	record.Set("operation_type", operationType)
	record.Set("trigger_source", string(model.TriggerSourceManualOps))
	record.Set("phase", string(model.OperationPhaseQueued))
	record.Set("queued_at", time.Now())

	return record
}
