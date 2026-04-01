package worker

import (
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/deploy"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func TestRecoverOrphanedDeploymentsMarksFailed(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	w := New(app)

	if _, err := app.FindCollectionByNameOrId("deployments"); err != nil {
		if err := w.recoverOrphanedDeployments(); err != nil {
			t.Fatal(err)
		}
		return
	}

	record := seedDeploymentRecord(t, app, "local", deploy.StatusRunning, nil)

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
	w := New(app)

	if _, err := app.FindCollectionByNameOrId("deployments"); err != nil {
		if err := w.recoverOrphanedDeployments(); err != nil {
			t.Fatal(err)
		}
		return
	}

	record := seedDeploymentRecord(t, app, "srv-1", deploy.StatusVerifying, map[string]any{"tag": "v1"})

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
	w := New(app)

	if _, err := app.FindCollectionByNameOrId("deployments"); err != nil {
		claimed, claimErr := w.claimQueuedDeployment("legacy-id")
		if claimErr != nil {
			t.Fatal(claimErr)
		}
		if claimed != nil {
			t.Fatal("expected no deployment to be claimed when deployments collection is absent")
		}
		return
	}

	seedDeploymentRecord(t, app, "local", deploy.StatusRunning, nil)
	queued := seedDeploymentRecord(t, app, "local", deploy.StatusQueued, nil)

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

func TestSyncAppInstanceFromDeploymentUsesLifecycleFields(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	record := seedLegacyDeploymentLikeRecord("local", deploy.StatusSuccess)
	if err := syncAppInstanceFromDeployment(app, record); err != nil {
		t.Fatal(err)
	}

	collection, err := app.FindCollectionByNameOrId("app_instances")
	if err != nil {
		t.Fatal(err)
	}
	storedRecords, err := app.FindRecordsByFilter(collection, `name = "demo-app"`, "", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(storedRecords) != 1 {
		t.Fatalf("expected 1 app instance, got %d", len(storedRecords))
	}
	stored := storedRecords[0]
	if got := stored.GetString("lifecycle_state"); got != "running_healthy" {
		t.Fatalf("expected running_healthy lifecycle state, got %q", got)
	}
	if got := stored.GetString("health_summary"); got != "healthy" {
		t.Fatalf("expected healthy health summary, got %q", got)
	}
	if got := stored.GetString("state_reason"); got != "legacy deployment synchronized" {
		t.Fatalf("expected lifecycle state_reason, got %q", got)
	}
	if got := stored.GetString("deployment_id"); got != "" {
		t.Fatalf("expected legacy deployment_id to remain unset, got %q", got)
	}
}

func seedLegacyDeploymentLikeRecord(serverID string, status string) *core.Record {
	collection := core.NewBaseCollection("legacy_deployments")
	record := core.NewRecord(collection)
	record.Set("server_id", serverID)
	record.Set("source", deploy.SourceManualOps)
	record.Set("status", status)
	record.Set("compose_project_name", "demo-app")
	record.Set("rendered_compose", "services:\n  web:\n    image: nginx:alpine\n")
	record.Set("project_dir", "/appos/data/apps/operations/demo-app")
	return record
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
