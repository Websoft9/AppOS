package status

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/monitor"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func TestSynthesizeAppTargetStatusUsesRegistryPolicy(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	seedQueryAppInstanceRecord(t, app, "appinstance0002", "Registry App")
	entry := monitor.TargetRegistryEntry{
		Checks: monitor.TargetCheckPolicies{
			AppHealth: &monitor.AppHealthTargetPolicy{
				StatusMap: map[string]string{
					monitor.StatusHealthy: monitor.StatusDegraded,
				},
				ReasonMap: map[string]string{
					monitor.StatusHealthy: "custom running mapping",
				},
				ReasonCodeMap: map[string]string{
					monitor.StatusHealthy: "custom_app_running",
				},
			},
		},
	}

	resp, err := synthesizeAppTargetStatus(app, "appinstance0002", entry)
	if err != nil {
		t.Fatal(err)
	}
	if resp.Status != monitor.StatusDegraded {
		t.Fatalf("expected custom synthesized app status, got %q", resp.Status)
	}
	if resp.Summary["reason_code"] != "custom_app_running" {
		t.Fatalf("expected custom synthesized app reason code, got %+v", resp.Summary)
	}
}

func seedQueryAppInstanceRecord(t *testing.T, app core.App, id string, name string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("app_instances")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("id", id)
	rec.Set("key", name+"-key")
	rec.Set("server_id", "local")
	rec.Set("name", name)
	rec.Set("runtime_status", "running")
	rec.Set("lifecycle_state", "running_healthy")
	rec.Set("desired_state", "running")
	rec.Set("health_summary", "healthy")
	rec.Set("publication_summary", "unpublished")
	rec.Set("state_reason", "seeded for monitor status query test")
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}
