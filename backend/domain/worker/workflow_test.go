package worker

import (
	"context"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/terminal"
	"github.com/websoft9/appos/backend/domain/workflow"
	"github.com/websoft9/appos/backend/infra/collections"
	"github.com/websoft9/appos/backend/infra/persistence"
)

func TestNewWorkflowRunTaskRequiresID(t *testing.T) {
	if _, err := NewWorkflowRunTask(""); err == nil {
		t.Fatal("expected error for empty run id")
	}
}

func TestRecoverOrphanedWorkflowRunsMarksRunningRunFailed(t *testing.T) {
	app := newWorkerTestApp(t)
	repo := persistence.NewWorkflowRepository(app)
	ctx := context.Background()

	workflowRecord := createWorkflowRecord(t, app)
	serverRecord := createServerFixture(t, app)
	run, err := repo.CreateRun(ctx, workflow.CreateRunInput{
		WorkflowID:       workflowRecord.Id,
		DefinitionYAML:   workflowRecord.GetString("definition_yaml"),
		Status:           workflow.RunStatusRunning,
		TriggerType:      workflow.TriggerManual,
		ResolvedServerID: serverRecord.Id,
		OverlapPolicy:    workflow.OverlapPolicySkip,
	})
	if err != nil {
		t.Fatalf("CreateRun: %v", err)
	}
	_, err = repo.CreateNodeRuns(ctx, run.ID, []workflow.NodeRunSeed{{
		NodeKey:       "collect",
		NodeType:      workflow.NodeTypeShell,
		DisplayName:   "collect",
		DependsOnJSON: "[]",
		Status:        workflow.NodeStatusRunning,
	}})
	if err != nil {
		t.Fatalf("CreateNodeRuns: %v", err)
	}

	w, err := New(app)
	if err != nil {
		t.Fatalf("New worker: %v", err)
	}
	if err := w.recoverOrphanedWorkflowRuns(); err != nil {
		t.Fatalf("recoverOrphanedWorkflowRuns: %v", err)
	}
	recovered, err := repo.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if recovered.Status != workflow.RunStatusFailed {
		t.Fatalf("expected failed run, got %q", recovered.Status)
	}
}

func TestHandleWorkflowRunSucceeds(t *testing.T) {
	oldExec := workflow.WorkflowExecuteSSHCommandForTesting
	workflow.WorkflowExecuteSSHCommandForTesting = func(ctx context.Context, cfg terminal.ConnectorConfig, command string, timeout time.Duration) (string, error) {
		return "ok", nil
	}
	t.Cleanup(func() { workflow.WorkflowExecuteSSHCommandForTesting = oldExec })

	app := newWorkerTestApp(t)
	repo := persistence.NewWorkflowRepository(app)
	ctx := context.Background()
	workflowRecord := createWorkflowRecord(t, app)
	serverRecord := createServerFixture(t, app)
	run, err := repo.CreateRun(ctx, workflow.CreateRunInput{
		WorkflowID:       workflowRecord.Id,
		DefinitionYAML:   workflowRecord.GetString("definition_yaml"),
		Status:           workflow.RunStatusPending,
		TriggerType:      workflow.TriggerManual,
		ResolvedServerID: serverRecord.Id,
		OverlapPolicy:    workflow.OverlapPolicySkip,
	})
	if err != nil {
		t.Fatalf("CreateRun: %v", err)
	}
	_, err = repo.CreateNodeRuns(ctx, run.ID, []workflow.NodeRunSeed{{
		NodeKey:       "collect",
		NodeType:      workflow.NodeTypeShell,
		DisplayName:   "collect",
		DependsOnJSON: "[]",
		Status:        workflow.NodeStatusPending,
	}})
	if err != nil {
		t.Fatalf("CreateNodeRuns: %v", err)
	}
	w, err := New(app)
	if err != nil {
		t.Fatalf("New worker: %v", err)
	}
	task, err := NewWorkflowRunTask(run.ID)
	if err != nil {
		t.Fatalf("NewWorkflowRunTask: %v", err)
	}
	if err := w.handleWorkflowRun(ctx, task); err != nil {
		t.Fatalf("handleWorkflowRun: %v", err)
	}
	updated, err := repo.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("GetRun: %v", err)
	}
	if updated.Status != workflow.RunStatusSucceeded {
		t.Fatalf("expected succeeded run, got %q", updated.Status)
	}
}

func createWorkflowRecord(t *testing.T, app core.App) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(collections.Workflows)
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(col)
	record.Set("name", "sample")
	record.Set("description", "sample")
	record.Set("is_enabled", true)
	record.Set("definition_yaml", "name: sample\ndefault_server_id: srv_1\nnodes:\n  - key: collect\n    type: shell\n    config:\n      command: echo ok\n")
	record.Set("default_server_id", "srv_1")
	record.Set("trigger_types_json", []any{"manual"})
	record.Set("node_count", 1)
	record.Set("has_ai_nodes", false)
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	return record
}

func createServerFixture(t *testing.T, app core.App) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("servers")
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(col)
	record.Set("name", "server-1")
	record.Set("host", "127.0.0.1")
	record.Set("port", 22)
	record.Set("user", "root")
	record.Set("is_enabled", true)
	record.Set("auth_type", "password")
	record.Set("credential", "")
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	return record
}
