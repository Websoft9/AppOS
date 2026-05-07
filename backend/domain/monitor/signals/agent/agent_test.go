package agent_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/monitor/signals/agent"
	"github.com/websoft9/appos/backend/domain/monitor/status/store"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/infra/collections"
)

func TestGetOrIssueAgentTokenRoundTripAndRotate(t *testing.T) {
	prepareAgentSecretKey(t)
	app := newAgentTestApp(t)
	defer app.Cleanup()

	first, changed, err := agent.GetOrIssueAgentToken(app, "server-1", false)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected first token issue to report changed=true")
	}
	serverID, err := agent.ValidateAgentToken(app, first)
	if err != nil {
		t.Fatal(err)
	}
	if serverID != "server-1" {
		t.Fatalf("expected validated server id server-1, got %q", serverID)
	}

	again, changed, err := agent.GetOrIssueAgentToken(app, "server-1", false)
	if err != nil {
		t.Fatal(err)
	}
	if changed {
		t.Fatal("expected unchanged token when rotate=false and token already exists")
	}
	if again != first {
		t.Fatal("expected existing token to be reused when rotate=false")
	}

	rotated, changed, err := agent.GetOrIssueAgentToken(app, "server-1", true)
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected rotate=true to report changed=true")
	}
	if rotated == first {
		t.Fatal("expected rotated token to differ from original token")
	}
}

func TestValidateAgentTokenScansBeyondFiveHundredSecrets(t *testing.T) {
	prepareAgentSecretKey(t)
	app := newAgentTestApp(t)
	defer app.Cleanup()

	var lastToken string
	for index := 0; index < 501; index++ {
		name := fmt.Sprintf("%sserver-%03d", monitor.AgentTokenSecretPrefix, index)
		token := fmt.Sprintf("token-%03d", index)
		_, err := secrets.UpsertSystemSingleValue(app, nil, name, monitor.AgentTokenSecretType, token)
		if err != nil {
			t.Fatal(err)
		}
		if index == 500 {
			lastToken = token
		}
	}

	serverID, err := agent.ValidateAgentToken(app, lastToken)
	if err != nil {
		t.Fatal(err)
	}
	if serverID != "server-500" {
		t.Fatalf("expected to resolve the 501st token for server-500, got %q", serverID)
	}
}

func TestIngestHeartbeatProjectsServerStatus(t *testing.T) {
	app := newAgentTestApp(t)
	defer app.Cleanup()

	receivedAt := time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC)
	reportedAt := receivedAt.Add(-15 * time.Second)
	accepted, err := agent.IngestHeartbeat(app, agent.HeartbeatIngest{
		ServerID:     "server-1",
		ServerName:   "Primary Server",
		AgentVersion: "1.2.3",
		ReportedAt:   reportedAt,
		ReceivedAt:   receivedAt,
		Items: []agent.HeartbeatItem{{
			TargetType: monitor.TargetTypeServer,
			TargetID:   "server-1",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if accepted != 1 {
		t.Fatalf("expected accepted=1, got %d", accepted)
	}

	record := loadAgentLatestStatusRecord(t, app, monitor.TargetTypeServer, "server-1")
	if got := record.GetString("status"); got != monitor.StatusHealthy {
		t.Fatalf("expected healthy heartbeat projection, got %q", got)
	}
	summary, err := store.SummaryFromRecord(record)
	if err != nil {
		t.Fatal(err)
	}
	if summary["heartbeat_state"] != monitor.HeartbeatStateFresh {
		t.Fatalf("expected fresh heartbeat state, got %+v", summary)
	}
	if summary["agent_version"] != "1.2.3" {
		t.Fatalf("expected agent version in summary, got %+v", summary)
	}
}

func TestIngestRuntimeStatusProjectsServerAndAppStatuses(t *testing.T) {
	app := newAgentTestApp(t)
	defer app.Cleanup()

	seedAgentAppInstanceRecord(t, app, "appinstance0001", "Demo App")
	observedAt := time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC)
	accepted, err := agent.IngestRuntimeStatus(app, agent.RuntimeStatusIngest{
		ServerID:   "server-1",
		ServerName: "Primary Server",
		ReportedAt: observedAt,
		Items: []agent.RuntimeStatusItem{{
			TargetType:   monitor.TargetTypeServer,
			TargetID:     "server-1",
			RuntimeState: "running",
			ObservedAt:   observedAt,
			Containers:   agent.RuntimeContainerSummary{Running: 3, Restarting: 1, Exited: 0},
			Apps:         []agent.RuntimeAppStatus{{AppID: "appinstance0001", RuntimeState: "running"}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if accepted != 1 {
		t.Fatalf("expected accepted=1, got %d", accepted)
	}

	serverRecord := loadAgentLatestStatusRecord(t, app, monitor.TargetTypeServer, "server-1")
	if got := serverRecord.GetString("status"); got != monitor.StatusHealthy {
		t.Fatalf("expected healthy server runtime status, got %q", got)
	}
	serverSummary, err := store.SummaryFromRecord(serverRecord)
	if err != nil {
		t.Fatal(err)
	}
	if serverSummary["app_count"] != float64(1) && serverSummary["app_count"] != 1 {
		t.Fatalf("expected app_count=1 in server summary, got %+v", serverSummary)
	}

	appRecord := loadAgentLatestStatusRecord(t, app, monitor.TargetTypeApp, "appinstance0001")
	if got := appRecord.GetString("display_name"); got != "Demo App" {
		t.Fatalf("expected app display name Demo App, got %q", got)
	}
	if got := appRecord.GetString("status"); got != monitor.StatusHealthy {
		t.Fatalf("expected healthy app runtime status, got %q", got)
	}
	appSummary, err := store.SummaryFromRecord(appRecord)
	if err != nil {
		t.Fatal(err)
	}
	if appSummary["server_id"] != "server-1" {
		t.Fatalf("expected app summary to include server_id, got %+v", appSummary)
	}
}

func seedAgentAppInstanceRecord(t *testing.T, app core.App, id string, name string) *core.Record {
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
	rec.Set("state_reason", "seeded for monitor agent test")
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func loadAgentLatestStatusRecord(t *testing.T, app core.App, targetType, targetID string) *core.Record {
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

func prepareAgentSecretKey(t *testing.T) {
	t.Helper()
	t.Setenv(secrets.EnvSecretKey, "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err := secrets.LoadKeyFromEnv(); err != nil {
		t.Fatal(err)
	}
	if err := secrets.LoadTemplatesFromDefaultPath(); err != nil {
		t.Fatal(err)
	}
}
