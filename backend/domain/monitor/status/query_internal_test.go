package status

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
)

func TestSynthesizeAppTargetStatusUsesRegistryPolicy(t *testing.T) {
	appRecord := seedQueryAppInstanceRecord("appinstance0002", "Registry App")
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

	resp := synthesizeAppTargetStatusFromRecord(appRecord, entry)
	if resp.Status != monitor.StatusDegraded {
		t.Fatalf("expected custom synthesized app status, got %q", resp.Status)
	}
	if resp.Summary["reason_code"] != "custom_app_running" {
		t.Fatalf("expected custom synthesized app reason code, got %+v", resp.Summary)
	}
}

func seedQueryAppInstanceRecord(id string, name string) *core.Record {
	col := core.NewBaseCollection("app_instances")
	rec := core.NewRecord(col)
	rec.Id = id
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
	return rec
}
