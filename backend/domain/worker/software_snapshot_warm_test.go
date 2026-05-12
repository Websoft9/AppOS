package worker

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/software"
	swprojection "github.com/websoft9/appos/backend/domain/software/projection"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func TestNewSoftwareSnapshotWarmTaskReturnsTask(t *testing.T) {
	task, err := NewSoftwareSnapshotWarmTask("srv-1", "user-1", []software.ComponentKey{software.ComponentKeyDocker})
	if err != nil {
		t.Fatalf("NewSoftwareSnapshotWarmTask: %v", err)
	}
	if task.Type() != TaskSoftwareWarmSnapshot {
		t.Fatalf("expected task type %q, got %q", TaskSoftwareWarmSnapshot, task.Type())
	}
	var payload SoftwareSnapshotWarmPayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.ServerID != "srv-1" {
		t.Fatalf("expected server_id srv-1, got %q", payload.ServerID)
	}
	if len(payload.ComponentKeys) != 1 || payload.ComponentKeys[0] != software.ComponentKeyDocker {
		t.Fatalf("unexpected component keys: %#v", payload.ComponentKeys)
	}
}

func TestEnqueueSoftwareSnapshotWarmRequiresClient(t *testing.T) {
	if err := EnqueueSoftwareSnapshotWarm(nil, "srv-1", "user-1", []software.ComponentKey{software.ComponentKeyDocker}); err == nil {
		t.Fatal("expected nil-client enqueue to fail")
	}
}

func TestHandleSoftwareSnapshotWarmSkipsFreshSnapshots(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	if err := swprojection.UpsertInventorySnapshot(app, software.TargetTypeServer, "srv-1", swprojection.Snapshot{
		ComponentKey:      software.ComponentKeyDocker,
		Label:             "Docker",
		TemplateKind:      software.TemplateKindPackage,
		InstalledState:    software.InstalledStateInstalled,
		VerificationState: software.VerificationStateHealthy,
		Preflight: &software.TargetReadinessResult{
			OK:              true,
			OSSupported:     true,
			PrivilegeOK:     true,
			NetworkOK:       true,
			DependencyReady: true,
			Issues:          []string{},
		},
	}); err != nil {
		t.Fatal(err)
	}

	executorCalled := false
	oldFactory := softwareExecutorFactory
	softwareExecutorFactory = func(app core.App, serverID, userID string) (software.ComponentExecutor, error) {
		executorCalled = true
		return &fakeSoftwareExecutor{}, nil
	}
	defer func() { softwareExecutorFactory = oldFactory }()

	w := &Worker{app: app}
	payload, err := json.Marshal(SoftwareSnapshotWarmPayload{
		ServerID:      "srv-1",
		UserID:        "user-1",
		ComponentKeys: []software.ComponentKey{software.ComponentKeyDocker},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := w.handleSoftwareSnapshotWarm(context.Background(), asynq.NewTask(TaskSoftwareWarmSnapshot, payload)); err != nil {
		t.Fatalf("handleSoftwareSnapshotWarm: %v", err)
	}
	if executorCalled {
		t.Fatal("expected fresh snapshot to skip executor creation")
	}
}
