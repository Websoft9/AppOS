package worker

import (
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/internal/deploy"

	_ "github.com/websoft9/appos/backend/internal/migrations"
)

func TestRecoverOrphanedDeploymentsMarksFailed(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	record := seedDeploymentRecord(t, app, "local", deploy.StatusRunning, nil)
	w := New(app)

	if err := w.recoverOrphanedDeployments(); err != nil {
		t.Fatal(err)
	}

	record, err = app.FindRecordById("deployments", record.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := record.GetString("status"); got != deploy.StatusFailed {
		t.Fatalf("expected failed status after orphan recovery, got %s", got)
	}
	if !strings.Contains(record.GetString("execution_log"), "worker startup detected orphaned deployment") {
		t.Fatal("expected orphan recovery log entry")
	}
}

func TestRecoverOrphanedDeploymentsEscalatesSnapshotToManualIntervention(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	record := seedDeploymentRecord(t, app, "srv-1", deploy.StatusVerifying, map[string]any{"tag": "v1"})
	w := New(app)

	if err := w.recoverOrphanedDeployments(); err != nil {
		t.Fatal(err)
	}

	record, err = app.FindRecordById("deployments", record.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := record.GetString("status"); got != deploy.StatusManualInterventionRequired {
		t.Fatalf("expected manual intervention status after snapshot recovery, got %s", got)
	}
	if !strings.Contains(record.GetString("execution_log"), "automatic rollback unavailable during orphan recovery") {
		t.Fatal("expected rollback escalation log entry")
	}
}

func TestClaimQueuedDeploymentRejectsActivePeer(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	seedDeploymentRecord(t, app, "local", deploy.StatusRunning, nil)
	queued := seedDeploymentRecord(t, app, "local", deploy.StatusQueued, nil)
	w := New(app)

	if _, err := w.claimQueuedDeployment(queued.Id); err == nil {
		t.Fatal("expected queued deployment claim to fail when another active deployment exists")
	}

	queued, err = app.FindRecordById("deployments", queued.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := queued.GetString("status"); got != deploy.StatusQueued {
		t.Fatalf("expected queued deployment to remain queued, got %s", got)
	}
}

func seedDeploymentRecord(t *testing.T, app core.App, serverID string, status string, releaseSnapshot any) *core.Record {
	t.Helper()

	col, err := app.FindCollectionByNameOrId("deployments")
	if err != nil {
		t.Fatal(err)
	}

	record := core.NewRecord(col)
	record.Set("server_id", serverID)
	record.Set("source", deploy.SourceManualOps)
	record.Set("status", status)
	record.Set("adapter", deploy.AdapterManualCompose)
	record.Set("compose_project_name", "demo-app")
	record.Set("rendered_compose", "services:\n  web:\n    image: nginx:alpine\n")
	if releaseSnapshot != nil {
		record.Set("release_snapshot", releaseSnapshot)
	}

	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}

	return record
}
