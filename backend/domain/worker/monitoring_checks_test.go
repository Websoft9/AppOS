package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/monitor/metrics"
	monitorchecks "github.com/websoft9/appos/backend/domain/monitor/signals/checks"
	"github.com/websoft9/appos/backend/domain/monitor/status/store"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/domain/terminal"
	"github.com/websoft9/appos/backend/infra/collections"
)

func TestHandleMonitorReachabilitySweepProjectsInstanceStatuses(t *testing.T) {
	app := newWorkerTestApp(t)

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

func TestHandleMonitorMetricsFreshnessProjectsNetdataFreshStatus(t *testing.T) {
	app := newWorkerTestApp(t)
	server := seedServerRecord(t, app, "metrics-prod-01")
	now := time.Now().UTC()
	restore := metrics.SetMetricQueryFuncForTest(func(_ context.Context, targetType, targetID, _ string, _ []string, _ metrics.MetricSeriesQueryOptions) (*metrics.MetricSeriesResponse, error) {
		response := &metrics.MetricSeriesResponse{TargetType: targetType, TargetID: targetID, Series: []metrics.MetricSeries{}}
		if targetID != server.Id {
			return response, nil
		}
		response.Series = []metrics.MetricSeries{{
			Name:   "cpu",
			Unit:   "percent",
			Points: [][]float64{{float64(now.Add(-20 * time.Second).Unix()), 42}},
		}}
		return response, nil
	})
	defer restore()

	w := New(app)
	task, err := NewMonitorMetricsFreshnessTask()
	if err != nil {
		t.Fatal(err)
	}
	if err := w.handleMonitorMetricsFreshness(context.Background(), task); err != nil {
		t.Fatal(err)
	}

	status := loadTargetLatestStatus(t, app, monitor.TargetTypeServer, server.Id)
	if got := status.GetString("status"); got != monitor.StatusHealthy {
		t.Fatalf("expected healthy metrics freshness status, got %q", got)
	}
	if got := status.GetString("signal_source"); got != monitor.SignalSourceNetdata {
		t.Fatalf("expected netdata signal source, got %q", got)
	}
	summary, err := store.SummaryFromRecord(status)
	if err != nil {
		t.Fatal(err)
	}
	if summary["metrics_freshness_state"] != monitor.MetricsFreshnessFresh {
		t.Fatalf("expected fresh metrics summary, got %+v", summary)
	}
	if summary["metrics_observed_at"] == nil {
		t.Fatalf("expected metrics_observed_at in summary, got %+v", summary)
	}
}

func TestEnqueueMonitorMetricsFreshnessRequiresClient(t *testing.T) {
	if err := EnqueueMonitorMetricsFreshness(nil); err == nil {
		t.Fatal("expected nil client error")
	}
}

func TestHandleMonitorControlReachabilityProjectsServerStatuses(t *testing.T) {
	app := newWorkerTestApp(t)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen control probe target: %v", err)
	}
	defer listener.Close()

	closedListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve closed control probe target: %v", err)
	}
	closedAddr := closedListener.Addr().String()
	_ = closedListener.Close()

	reachable := seedServerRecord(t, app, "control-prod-01")
	reachableHost, reachablePort, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	reachablePortNumber, err := strconv.Atoi(reachablePort)
	if err != nil {
		t.Fatal(err)
	}
	reachable.Set("host", reachableHost)
	reachable.Set("port", reachablePortNumber)
	if err := app.Save(reachable); err != nil {
		t.Fatal(err)
	}

	offline := seedServerRecord(t, app, "control-prod-02")
	offlineHost, offlinePort, err := net.SplitHostPort(closedAddr)
	if err != nil {
		t.Fatal(err)
	}
	offlinePortNumber, err := strconv.Atoi(offlinePort)
	if err != nil {
		t.Fatal(err)
	}
	offline.Set("host", offlineHost)
	offline.Set("port", offlinePortNumber)
	if err := app.Save(offline); err != nil {
		t.Fatal(err)
	}

	w := New(app)
	task, err := NewMonitorControlReachabilityTask()
	if err != nil {
		t.Fatal(err)
	}
	if err := w.handleMonitorControlReachability(context.Background(), task); err != nil {
		t.Fatal(err)
	}

	reachableStatus := loadTargetLatestStatus(t, app, monitor.TargetTypeServer, reachable.Id)
	if got := reachableStatus.GetString("status"); got != monitor.StatusHealthy {
		t.Fatalf("expected reachable control status healthy, got %q", got)
	}
	if got := reachableStatus.GetString("signal_source"); got != monitor.SignalSourceAppOS {
		t.Fatalf("expected appos active check source, got %q", got)
	}
	reachableSummary, err := store.SummaryFromRecord(reachableStatus)
	if err != nil {
		t.Fatal(err)
	}
	if reachableSummary["check_kind"] != monitor.CheckKindControlReachability {
		t.Fatalf("expected control reachability check kind, got %+v", reachableSummary)
	}
	if reachableSummary["control_reachability_state"] != "reachable" {
		t.Fatalf("expected reachable control state, got %+v", reachableSummary)
	}
	if _, ok := reachableSummary["reason_code"]; ok {
		t.Fatalf("expected healthy control summary to omit reason_code, got %+v", reachableSummary)
	}
	reachableRecord, err := app.FindRecordById("servers", reachable.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := reachableRecord.GetString("access_status"); got != "available" {
		t.Fatalf("expected reachable server access cache available, got %q", got)
	}
	if got := reachableRecord.GetString("access_reason"); got != "" {
		t.Fatalf("expected reachable server access reason empty, got %q", got)
	}

	offlineStatus := loadTargetLatestStatus(t, app, monitor.TargetTypeServer, offline.Id)
	if got := offlineStatus.GetString("status"); got != monitor.StatusUnreachable {
		t.Fatalf("expected offline control status unreachable, got %q", got)
	}
	if offlineStatus.GetInt("consecutive_failures") != 1 {
		t.Fatalf("expected offline control consecutive_failures 1, got %d", offlineStatus.GetInt("consecutive_failures"))
	}
	offlineSummary, err := store.SummaryFromRecord(offlineStatus)
	if err != nil {
		t.Fatal(err)
	}
	if offlineSummary["reason_code"] != "control_unreachable" {
		t.Fatalf("expected control_unreachable reason_code, got %+v", offlineSummary)
	}
	if offlineSummary["probe_protocol"] != "ssh" {
		t.Fatalf("expected ssh probe protocol, got %+v", offlineSummary)
	}
	offlineRecord, err := app.FindRecordById("servers", offline.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := offlineRecord.GetString("access_status"); got != "unavailable" {
		t.Fatalf("expected offline server access cache unavailable, got %q", got)
	}
	if got := offlineRecord.GetString("access_reason"); got != "control_unreachable" {
		t.Fatalf("expected offline server access reason control_unreachable, got %q", got)
	}
	if offlineRecord.GetDateTime("access_checked_at").IsZero() {
		t.Fatal("expected offline server access_checked_at to be updated")
	}

	offlineRecord.Set("host", reachableHost)
	offlineRecord.Set("port", reachablePortNumber)
	if err := app.Save(offlineRecord); err != nil {
		t.Fatal(err)
	}
	if err := w.handleMonitorControlReachability(context.Background(), task); err != nil {
		t.Fatal(err)
	}
	recoveredStatus := loadTargetLatestStatus(t, app, monitor.TargetTypeServer, offline.Id)
	if got := recoveredStatus.GetString("status"); got != monitor.StatusHealthy {
		t.Fatalf("expected control reachability to recover from unreachable to healthy, got %q", got)
	}
	recoveredRecord, err := app.FindRecordById("servers", offline.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := recoveredRecord.GetString("access_status"); got != "available" {
		t.Fatalf("expected recovered server access cache available, got %q", got)
	}
}

func TestEnqueueMonitorControlReachabilityRequiresClient(t *testing.T) {
	if err := EnqueueMonitorControlReachability(nil); err == nil {
		t.Fatal("expected nil client error")
	}
}

func TestHandleMonitorFactsPullWritesServerFactsSnapshot(t *testing.T) {
	app := newWorkerTestApp(t)
	server := seedServerRecord(t, app, "facts-prod-01")

	var capturedCfg terminal.ConnectorConfig
	restore := monitorchecks.SetServerFactsCommandExecutorForTest(func(_ context.Context, cfg terminal.ConnectorConfig, command string, timeout time.Duration) (string, error) {
		capturedCfg = cfg
		if !strings.Contains(command, "os.family") {
			t.Fatalf("expected facts command to print os.family, got %q", command)
		}
		if !strings.Contains(command, "cloud.provider") {
			t.Fatalf("expected facts command to print cloud.provider when available, got %q", command)
		}
		if timeout <= 0 {
			t.Fatal("expected positive facts pull timeout")
		}
		return "os.family=Linux\nos.distribution=Ubuntu\nos.version=24.04\nkernel.release=6.8.0-31-generic\narchitecture=x86_64\ncpu.cores=4\nmemory.total_bytes=8589934592\ncloud.provider=aws\ncloud.region=cn-northwest-1\ncloud.zone=cn-northwest-1a\ncloud.source=cloud-init\n", nil
	})
	defer restore()

	w := New(app)
	task, err := NewMonitorFactsPullTask()
	if err != nil {
		t.Fatal(err)
	}
	if err := w.handleMonitorFactsPull(context.Background(), task); err != nil {
		t.Fatal(err)
	}
	if capturedCfg.Host != "192.168.1.10" || capturedCfg.Port != 22 || capturedCfg.User != "root" {
		t.Fatalf("expected server access config to be used, got %+v", capturedCfg)
	}

	stored, err := app.FindRecordById("servers", server.Id)
	if err != nil {
		t.Fatal(err)
	}
	facts := mustWorkerJSONMap(t, stored.Get("facts_json"))
	if facts["architecture"] != "x86_64" {
		t.Fatalf("expected architecture from facts pull, got %+v", facts)
	}
	osFacts := mustWorkerJSONMap(t, facts["os"])
	if osFacts["distribution"] != "Ubuntu" {
		t.Fatalf("expected Ubuntu facts distribution, got %+v", facts)
	}
	cloudFacts := mustWorkerJSONMap(t, facts["cloud"])
	if cloudFacts["provider"] != "aws" || cloudFacts["region"] != "cn-northwest-1" || cloudFacts["source"] != "cloud-init" {
		t.Fatalf("expected cloud facts from facts pull, got %+v", facts)
	}
	if got := stored.GetDateTime("facts_observed_at").Time().UTC(); got.IsZero() {
		t.Fatal("expected facts_observed_at to be set")
	}
}

func TestEnqueueMonitorFactsPullRequiresClient(t *testing.T) {
	if err := EnqueueMonitorFactsPull(nil); err == nil {
		t.Fatal("expected nil client error")
	}
}

func TestHandleMonitorRuntimeSnapshotPullProjectsServerRuntime(t *testing.T) {
	app := newWorkerTestApp(t)
	server := seedServerRecord(t, app, "runtime-prod-01")

	var capturedCfg terminal.ConnectorConfig
	restore := monitorchecks.SetServerRuntimeCommandExecutorForTest(func(_ context.Context, cfg terminal.ConnectorConfig, command string, timeout time.Duration) (string, error) {
		capturedCfg = cfg
		if !strings.Contains(command, "docker ps") {
			t.Fatalf("expected runtime command to inspect docker state, got %q", command)
		}
		if timeout <= 0 {
			t.Fatal("expected positive runtime pull timeout")
		}
		return "running\nrunning\nrestarting\nexited\n", nil
	})
	defer restore()

	w := New(app)
	task, err := NewMonitorRuntimeSnapshotPullTask()
	if err != nil {
		t.Fatal(err)
	}
	if err := w.handleMonitorRuntimeSnapshotPull(context.Background(), task); err != nil {
		t.Fatal(err)
	}
	if capturedCfg.Host != "192.168.1.10" || capturedCfg.Port != 22 || capturedCfg.User != "root" {
		t.Fatalf("expected server access config to be used, got %+v", capturedCfg)
	}

	status := loadTargetLatestStatus(t, app, monitor.TargetTypeServer, server.Id)
	if got := status.GetString("status"); got != monitor.StatusDegraded {
		t.Fatalf("expected degraded runtime status, got %q", got)
	}
	if got := status.GetString("signal_source"); got != monitor.SignalSourceAppOS {
		t.Fatalf("expected appos active check source, got %q", got)
	}
	summary, err := store.SummaryFromRecord(status)
	if err != nil {
		t.Fatal(err)
	}
	if summary["check_kind"] != monitor.CheckKindRuntime {
		t.Fatalf("expected runtime_summary check kind, got %+v", summary)
	}
	if summary["signal_source"] != monitor.SignalSourceAppOS {
		t.Fatalf("expected appos signal source in summary, got %+v", summary)
	}
	if summary["runtime_state"] != monitor.StatusDegraded {
		t.Fatalf("expected degraded runtime_state, got %+v", summary)
	}
	if asInt(summary["containers_running"]) != 2 || asInt(summary["containers_restarting"]) != 1 || asInt(summary["containers_exited"]) != 1 {
		t.Fatalf("expected container counts from runtime pull, got %+v", summary)
	}
	if summary["reason_code"] != "runtime_degraded" {
		t.Fatalf("expected runtime_degraded reason_code, got %+v", summary)
	}
}

func TestEnqueueMonitorRuntimeSnapshotPullRequiresClient(t *testing.T) {
	if err := EnqueueMonitorRuntimeSnapshotPull(nil); err == nil {
		t.Fatal("expected nil client error")
	}
}

func TestHandleMonitorCredentialSweepProjectsCredentialInvalidWhenSecretMissing(t *testing.T) {
	prepareWorkerSecretKey(t)
	app := newWorkerTestApp(t)

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
	app := newWorkerTestApp(t)

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

func seedServerRecord(t *testing.T, app core.App, name string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("servers")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", name)
	rec.Set("host", "192.168.1.10")
	rec.Set("port", 22)
	rec.Set("user", "root")
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
	if err := secrets.LoadTemplatesFromDefaultPath(); err != nil {
		t.Fatal(err)
	}
}

func mustWorkerJSONMap(t *testing.T, value any) map[string]any {
	t.Helper()
	if direct, ok := value.(map[string]any); ok {
		return direct
	}
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal json field: %v", err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("unmarshal json field: %v", err)
	}
	return parsed
}

func asInt(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return 0
	}
}
