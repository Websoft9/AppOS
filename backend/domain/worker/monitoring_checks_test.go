package worker

import (
	"context"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/monitor/status/store"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/infra/collections"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func TestHandleMonitorReachabilitySweepProjectsInstanceStatuses(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen probe target: %v", err)
	}
	defer listener.Close()

	closedListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve closed probe target: %v", err)
	}
	closedAddr := closedListener.Addr().String()
	_ = closedListener.Close()

	reachable := seedInstanceRecord(t, app, "reachable-redis", "redis", listener.Addr().String())
	offline := seedInstanceRecord(t, app, "offline-redis", "redis", closedAddr)
	skipped := seedInstanceRecord(t, app, "bucket-s3", "s3", "https://s3.example.com")

	w := New(app)
	task, err := NewMonitorReachabilitySweepTask()
	if err != nil {
		t.Fatal(err)
	}
	if err := w.handleMonitorReachabilitySweep(context.Background(), task); err != nil {
		t.Fatal(err)
	}

	reachableStatus := loadLatestStatus(t, app, reachable.Id)
	if got := reachableStatus.GetString("status"); got != monitor.StatusHealthy {
		t.Fatalf("expected reachable status healthy, got %q", got)
	}
	reachableSummary, err := store.SummaryFromRecord(reachableStatus)
	if err != nil {
		t.Fatal(err)
	}
	if reachableSummary["check_kind"] != monitor.CheckKindReachability {
		t.Fatalf("expected check_kind reachability, got %+v", reachableSummary)
	}
	if reachableSummary["host"] == nil || reachableSummary["port"] == nil {
		t.Fatalf("expected host and port in summary, got %+v", reachableSummary)
	}
	if _, ok := reachableSummary["reason_code"]; ok {
		t.Fatalf("expected healthy reachability summary to omit reason_code, got %+v", reachableSummary)
	}

	offlineStatus := loadLatestStatus(t, app, offline.Id)
	if got := offlineStatus.GetString("status"); got != monitor.StatusUnreachable {
		t.Fatalf("expected offline status unreachable, got %q", got)
	}
	if offlineStatus.GetInt("consecutive_failures") != 1 {
		t.Fatalf("expected consecutive_failures 1, got %d", offlineStatus.GetInt("consecutive_failures"))
	}
	if offlineStatus.GetString("signal_source") != monitor.SignalSourceAppOS {
		t.Fatalf("expected appos active check source, got %q", offlineStatus.GetString("signal_source"))
	}
	offlineSummary, err := store.SummaryFromRecord(offlineStatus)
	if err != nil {
		t.Fatal(err)
	}
	if offlineSummary["reason_code"] != "endpoint_unreachable" {
		t.Fatalf("expected endpoint_unreachable reason_code, got %+v", offlineSummary)
	}

	if _, err := app.FindFirstRecordByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": monitor.TargetTypeResource, "targetID": skipped.Id},
	); err == nil {
		t.Fatal("expected s3 instance to stay outside initial reachability registry")
	}
}

func TestEnqueueMonitorReachabilitySweepRequiresClient(t *testing.T) {
	if err := EnqueueMonitorReachabilitySweep(nil); err == nil {
		t.Fatal("expected nil client error")
	}
}

func TestHandleMonitorHeartbeatFreshnessProjectsOfflineStatus(t *testing.T) {
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
	staleAt := time.Now().UTC().Add(-monitor.OfflineHeartbeatThreshold).Add(-time.Minute)
	record.Set("target_type", monitor.TargetTypeServer)
	record.Set("target_id", "srv-1")
	record.Set("display_name", "prod-01")
	record.Set("status", monitor.StatusHealthy)
	record.Set("signal_source", monitor.SignalSourceAgent)
	record.Set("last_transition_at", staleAt.Format(time.RFC3339))
	record.Set("last_success_at", staleAt.Format(time.RFC3339))
	record.Set("last_reported_at", staleAt.Format(time.RFC3339))
	record.Set("consecutive_failures", 0)
	record.Set("summary_json", map[string]any{"heartbeat_state": monitor.HeartbeatStateFresh})
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}

	w := New(app)
	task, err := NewMonitorHeartbeatFreshnessTask()
	if err != nil {
		t.Fatal(err)
	}
	if err := w.handleMonitorHeartbeatFreshness(context.Background(), task); err != nil {
		t.Fatal(err)
	}

	record, err = app.FindRecordById(collections.MonitorLatestStatus, record.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := record.GetString("status"); got != monitor.StatusOffline {
		t.Fatalf("expected offline status, got %q", got)
	}
	summary, err := store.SummaryFromRecord(record)
	if err != nil {
		t.Fatal(err)
	}
	if summary["heartbeat_state"] != monitor.HeartbeatStateOffline {
		t.Fatalf("expected offline heartbeat summary, got %+v", summary)
	}
	if summary["reason_code"] != "heartbeat_missing" {
		t.Fatalf("expected heartbeat_missing reason_code, got %+v", summary)
	}
}

func TestEnqueueMonitorHeartbeatFreshnessRequiresClient(t *testing.T) {
	if err := EnqueueMonitorHeartbeatFreshness(nil); err == nil {
		t.Fatal("expected nil client error")
	}
}

func TestHandleMonitorCredentialSweepProjectsCredentialInvalidWhenSecretMissing(t *testing.T) {
	prepareWorkerSecretKey(t)
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	secret := seedWorkerSecretRecord(t, app, "secretredis0003", secrets.StatusRevoked)
	item := seedInstanceRecord(t, app, "redis-with-missing-secret", "redis", "127.0.0.1:6379")
	item.Set("credential", secret.Id)
	if err := app.Save(item); err != nil {
		t.Fatal(err)
	}

	w := New(app)
	task, err := NewMonitorCredentialSweepTask()
	if err != nil {
		t.Fatal(err)
	}
	if err := w.handleMonitorCredentialSweep(context.Background(), task); err != nil {
		t.Fatal(err)
	}

	status := loadLatestStatus(t, app, item.Id)
	if got := status.GetString("status"); got != monitor.StatusCredentialInvalid {
		t.Fatalf("expected credential_invalid status, got %q", got)
	}
	summary, err := store.SummaryFromRecord(status)
	if err != nil {
		t.Fatal(err)
	}
	if summary["check_kind"] != monitor.CheckKindCredential {
		t.Fatalf("expected credential check kind, got %+v", summary)
	}
	if summary["reason_code"] != "credential_auth_failed" {
		t.Fatalf("expected credential_auth_failed reason_code, got %+v", summary)
	}
}

func TestEnqueueMonitorCredentialSweepRequiresClient(t *testing.T) {
	if err := EnqueueMonitorCredentialSweep(nil); err == nil {
		t.Fatal("expected nil client error")
	}
}

func TestHandleMonitorAppHealthSweepProjectsAppStatuses(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	healthy := seedAppInstanceRecord(t, app, "healthy-app", "running", "healthy")
	degraded := seedAppInstanceRecord(t, app, "degraded-app", "running", "degraded")
	offline := seedAppInstanceRecord(t, app, "offline-app", "stopped", "stopped")

	w := New(app)
	task, err := NewMonitorAppHealthSweepTask()
	if err != nil {
		t.Fatal(err)
	}
	if err := w.handleMonitorAppHealthSweep(context.Background(), task); err != nil {
		t.Fatal(err)
	}

	healthyStatus := loadTargetLatestStatus(t, app, monitor.TargetTypeApp, healthy.Id)
	if got := healthyStatus.GetString("status"); got != monitor.StatusHealthy {
		t.Fatalf("expected healthy app status healthy, got %q", got)
	}
	healthySummary, err := store.SummaryFromRecord(healthyStatus)
	if err != nil {
		t.Fatal(err)
	}
	if healthySummary["check_kind"] != monitor.CheckKindAppHealth {
		t.Fatalf("expected app_health check kind, got %+v", healthySummary)
	}
	if _, ok := healthySummary["reason_code"]; ok {
		t.Fatalf("expected healthy app summary to omit reason_code, got %+v", healthySummary)
	}

	degradedStatus := loadTargetLatestStatus(t, app, monitor.TargetTypeApp, degraded.Id)
	if got := degradedStatus.GetString("status"); got != monitor.StatusDegraded {
		t.Fatalf("expected degraded app status degraded, got %q", got)
	}
	degradedSummary, err := store.SummaryFromRecord(degradedStatus)
	if err != nil {
		t.Fatal(err)
	}
	if degradedSummary["reason_code"] != "app_runtime_unhealthy" {
		t.Fatalf("expected app_runtime_unhealthy reason_code, got %+v", degradedSummary)
	}

	offlineStatus := loadTargetLatestStatus(t, app, monitor.TargetTypeApp, offline.Id)
	if got := offlineStatus.GetString("status"); got != monitor.StatusOffline {
		t.Fatalf("expected offline app status offline, got %q", got)
	}
	if offlineStatus.GetString("signal_source") != monitor.SignalSourceAppOS {
		t.Fatalf("expected appos active check source, got %q", offlineStatus.GetString("signal_source"))
	}
	if offlineStatus.GetInt("consecutive_failures") != 1 {
		t.Fatalf("expected offline app consecutive_failures 1, got %d", offlineStatus.GetInt("consecutive_failures"))
	}
	offlineSummary, err := store.SummaryFromRecord(offlineStatus)
	if err != nil {
		t.Fatal(err)
	}
	if offlineSummary["reason_code"] != "app_not_running" {
		t.Fatalf("expected app_not_running reason_code, got %+v", offlineSummary)
	}
	if offlineSummary["runtime_status"] != "stopped" {
		t.Fatalf("expected stopped runtime_status in summary, got %+v", offlineSummary)
	}
}

func TestEnqueueMonitorAppHealthSweepRequiresClient(t *testing.T) {
	if err := EnqueueMonitorAppHealthSweep(nil); err == nil {
		t.Fatal("expected nil client error")
	}
}

func seedInstanceRecord(t *testing.T, app core.App, name string, kind string, endpoint string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(collections.Instances)
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", name)
	rec.Set("kind", kind)
	rec.Set("template_id", fmt.Sprintf("generic-%s", kind))
	rec.Set("endpoint", endpoint)
	rec.Set("config", map[string]any{})
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func seedAppInstanceRecord(t *testing.T, app core.App, name string, runtimeStatus string, healthSummary string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("app_instances")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("key", name+"-key")
	rec.Set("name", name)
	rec.Set("server_id", "srv-1")
	rec.Set("runtime_status", runtimeStatus)
	rec.Set("health_summary", healthSummary)
	rec.Set("publication_summary", "published")
	rec.Set("lifecycle_state", "running_healthy")
	rec.Set("desired_state", "running")
	if strings.EqualFold(runtimeStatus, "stopped") {
		rec.Set("lifecycle_state", "stopped")
		rec.Set("desired_state", "stopped")
	}
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func loadLatestStatus(t *testing.T, app core.App, targetID string) *core.Record {
	t.Helper()
	return loadTargetLatestStatus(t, app, monitor.TargetTypeResource, targetID)
}

func loadTargetLatestStatus(t *testing.T, app core.App, targetType string, targetID string) *core.Record {
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

func seedWorkerSecretRecord(t *testing.T, app core.App, secretID string, status string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	enc, err := secrets.EncryptPayload(map[string]any{"value": "secret"})
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("id", secretID)
	rec.Set("name", secretID)
	rec.Set("scope", secrets.ScopeGlobal)
	rec.Set("status", status)
	rec.Set("template_id", secrets.TemplateSingleValue)
	rec.Set("payload_encrypted", enc)
	rec.Set("created_source", secrets.CreatedSourceUser)
	rec.Set("created_by", "user-1")
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func prepareWorkerSecretKey(t *testing.T) {
	t.Helper()
	t.Setenv(secrets.EnvSecretKey, "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err := secrets.LoadKeyFromEnv(); err != nil {
		t.Fatal(err)
	}
}
