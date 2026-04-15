package routes

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/infra/collections"
)

func newMonitorTestEnv(t *testing.T) *testEnv {
	t.Helper()
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	t.Setenv(secrets.EnvSecretKey, key)
	if err := secrets.LoadKeyFromEnv(); err != nil {
		t.Fatalf("load secret key: %v", err)
	}
	if err := secrets.LoadTemplatesFromFile(filepath.Clean("/data/dev/appos/backend/domain/secrets/templates.json")); err != nil {
		t.Fatalf("load secret templates: %v", err)
	}
	return newTestEnv(t)
}

func (te *testEnv) doMonitor(t *testing.T, method, url, body string, authHeader string) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	registerMonitorRoutes(&core.ServeEvent{App: te.app, Router: r})

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func (te *testEnv) doMonitorWithHeaders(t *testing.T, method, url, body string, authHeader string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	registerMonitorRoutes(&core.ServeEvent{App: te.app, Router: r})

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func createMonitorServer(t *testing.T, te *testEnv, name string) *core.Record {
	t.Helper()
	col, err := te.app.FindCollectionByNameOrId("servers")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", name)
	rec.Set("host", "192.168.1.10")
	rec.Set("port", 22)
	rec.Set("user", "root")
	if err := te.app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func createMonitorApp(t *testing.T, te *testEnv, id string, name string, serverID string) *core.Record {
	t.Helper()
	rec := seedAppInstance(t, te, name)
	rec.Set("server_id", serverID)
	rec.Set("key", id+"-monitor-key")
	rec.Set("lifecycle_state", "running_healthy")
	rec.Set("health_summary", "healthy")
	rec.Set("publication_summary", "unpublished")
	if err := te.app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func TestMonitorAgentTokenCreateAndRotate(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")

	rec := te.doMonitor(t, http.MethodPost, "/api/monitor/servers/"+server.Id+"/agent-token", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var first map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	firstToken, _ := first["token"].(string)
	if firstToken == "" {
		t.Fatalf("expected token in response, got %s", rec.Body.String())
	}

	rec = te.doMonitor(t, http.MethodPost, "/api/monitor/servers/"+server.Id+"/agent-token?rotate=true", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 on rotate, got %d: %s", rec.Code, rec.Body.String())
	}
	var rotated map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &rotated); err != nil {
		t.Fatal(err)
	}
	secondToken, _ := rotated["token"].(string)
	if secondToken == "" || secondToken == firstToken {
		t.Fatalf("expected rotated token to differ, first=%q second=%q", firstToken, secondToken)
	}
}

func TestMonitorAgentSetupKeepsRequestHostPort(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")

	rec := te.doMonitor(t, http.MethodGet, "https://appos.example.com:9443/api/monitor/servers/"+server.Id+"/agent-setup", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var response map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if got := response["ingestBaseUrl"]; got != "https://appos.example.com:9443/api/monitor/ingest" {
		t.Fatalf("expected request-host ingest base url with port preserved, got %v", got)
	}
	configYaml, _ := response["configYaml"].(string)
	if !strings.Contains(configYaml, "ingest_base_url: https://appos.example.com:9443/api/monitor/ingest") {
		t.Fatalf("expected config yaml to contain request-host ingest url, got %q", configYaml)
	}
}

func TestMonitorAgentSetupUsesForwardedProtoWithRequestHostPort(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	rec := te.doMonitorWithHeaders(t, http.MethodGet, "http://console.example.com:8090/api/monitor/servers/"+server.Id+"/agent-setup", "", te.token, map[string]string{
		"X-Forwarded-Proto": "https",
		"X-Forwarded-Host":  "ignored.example.com",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var response map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if got := response["ingestBaseUrl"]; got != "https://console.example.com:8090/api/monitor/ingest" {
		t.Fatalf("expected monitor setup to use request host port and forwarded proto, got %v", got)
	}
}

func TestMonitorAgentSetupUsesForwardedHostPortWhenProxyDropsRequestPort(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	rec := te.doMonitorWithHeaders(t, http.MethodGet, "http://console.example.com/api/monitor/servers/"+server.Id+"/agent-setup", "", te.token, map[string]string{
		"X-Forwarded-Host":  "console.example.com:9091",
		"X-Forwarded-Proto": "https",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var response map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if got := response["ingestBaseUrl"]; got != "https://console.example.com:9091/api/monitor/ingest" {
		t.Fatalf("expected monitor setup to recover proxy-forwarded host port, got %v", got)
	}
	configYaml, _ := response["configYaml"].(string)
	if !strings.Contains(configYaml, "ingest_base_url: https://console.example.com:9091/api/monitor/ingest") {
		t.Fatalf("expected config yaml to contain forwarded-host ingest url, got %q", configYaml)
	}
}

func TestMonitorAgentSetupUsesForwardedPortWhenHostLacksPort(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	rec := te.doMonitorWithHeaders(t, http.MethodGet, "http://console.example.com/api/monitor/servers/"+server.Id+"/agent-setup", "", te.token, map[string]string{
		"X-Forwarded-Port":  "9091",
		"X-Forwarded-Proto": "http",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var response map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if got := response["ingestBaseUrl"]; got != "http://console.example.com:9091/api/monitor/ingest" {
		t.Fatalf("expected monitor setup to append forwarded port, got %v", got)
	}
}

func TestMonitorHeartbeatIngestCreatesLatestStatus(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, _, err := monitor.GetOrIssueAgentToken(te.app, server.Id, false)
	if err != nil {
		t.Fatal(err)
	}
	body := `{"serverId":"` + server.Id + `","agentVersion":"0.1.0","reportedAt":"2026-04-14T12:00:00Z","items":[{"targetType":"server","targetId":"` + server.Id + `","status":"healthy","observedAt":"2026-04-14T12:00:00Z"}]}`
	rec := te.doMonitor(t, http.MethodPost, "/api/monitor/ingest/heartbeat", body, "Bearer "+token)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	record, err := te.app.FindFirstRecordByFilter(collections.MonitorLatestStatus, "target_type = {:targetType} && target_id = {:id}", map[string]any{"targetType": monitor.TargetTypeServer, "id": server.Id})
	if err != nil {
		t.Fatal(err)
	}
	if record.GetString("status") != monitor.StatusHealthy {
		t.Fatalf("expected healthy status, got %q", record.GetString("status"))
	}
	if record.GetString("display_name") != "prod-01" {
		t.Fatalf("expected display name prod-01, got %q", record.GetString("display_name"))
	}
}

func TestMonitorOverviewRefreshesOfflineHeartbeat(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	staleAt := time.Now().UTC().Add(-monitor.OfflineHeartbeatThreshold).Add(-time.Minute)
	zeroFailures := 0
	if _, err := monitor.UpsertLatestStatus(te.app, monitor.LatestStatusUpsert{
		TargetType:          monitor.TargetTypeServer,
		TargetID:            server.Id,
		DisplayName:         server.GetString("name"),
		Status:              monitor.StatusHealthy,
		SignalSource:        monitor.SignalSourceAgent,
		LastTransitionAt:    staleAt,
		LastSuccessAt:       &staleAt,
		LastReportedAt:      &staleAt,
		ConsecutiveFailures: &zeroFailures,
		Summary:             map[string]any{"heartbeat_state": monitor.HeartbeatStateFresh},
	}); err != nil {
		t.Fatal(err)
	}

	rec := te.doMonitor(t, http.MethodGet, "/api/monitor/overview", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Counts         map[string]int `json:"counts"`
		UnhealthyItems []struct {
			TargetID string `json:"targetId"`
			Status   string `json:"status"`
		} `json:"unhealthyItems"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Counts[monitor.StatusOffline] != 1 {
		t.Fatalf("expected offline count 1, got %+v", resp.Counts)
	}
	if len(resp.UnhealthyItems) != 1 || resp.UnhealthyItems[0].TargetID != server.Id || resp.UnhealthyItems[0].Status != monitor.StatusOffline {
		t.Fatalf("unexpected unhealthy items: %s", rec.Body.String())
	}
}

func TestMonitorTargetStatusReturnsDetail(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	zeroFailures := 0
	now := time.Now().UTC()
	if _, err := monitor.UpsertLatestStatus(te.app, monitor.LatestStatusUpsert{
		TargetType:          monitor.TargetTypeServer,
		TargetID:            server.Id,
		DisplayName:         server.GetString("name"),
		Status:              monitor.StatusHealthy,
		SignalSource:        monitor.SignalSourceAgent,
		LastTransitionAt:    now,
		LastSuccessAt:       &now,
		LastReportedAt:      &now,
		ConsecutiveFailures: &zeroFailures,
		Summary: map[string]any{
			"heartbeat_state": "fresh",
		},
	}); err != nil {
		t.Fatal(err)
	}

	rec := te.doMonitor(t, http.MethodGet, "/api/monitor/targets/server/"+server.Id, "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		TargetID string         `json:"targetId"`
		Status   string         `json:"status"`
		Summary  map[string]any `json:"summary"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.TargetID != server.Id || resp.Status != monitor.StatusHealthy {
		t.Fatalf("unexpected monitor target response: %s", rec.Body.String())
	}
	if resp.Summary["heartbeat_state"] != "fresh" {
		t.Fatalf("expected heartbeat summary, got %+v", resp.Summary)
	}
}

func TestMonitorTargetStatusSynthesizesServerDetailWithoutHeartbeat(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "test")
	if _, _, err := monitor.GetOrIssueAgentToken(te.app, server.Id, false); err != nil {
		t.Fatal(err)
	}

	rec := te.doMonitor(t, http.MethodGet, "/api/monitor/targets/server/"+server.Id, "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		HasData      bool           `json:"hasData"`
		TargetID     string         `json:"targetId"`
		Status       string         `json:"status"`
		SignalSource string         `json:"signalSource"`
		Summary      map[string]any `json:"summary"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.HasData {
		t.Fatalf("expected synthesized response without persisted data: %s", rec.Body.String())
	}
	if resp.TargetID != server.Id || resp.Status != monitor.StatusUnknown {
		t.Fatalf("unexpected synthesized monitor target response: %s", rec.Body.String())
	}
	if resp.SignalSource != monitor.SignalSourceInventory {
		t.Fatalf("expected inventory signal source, got %q", resp.SignalSource)
	}
	if resp.Summary["agent_token_configured"] != true {
		t.Fatalf("expected configured agent token summary, got %+v", resp.Summary)
	}
}

func TestMonitorTargetStatusSynthesizesAppDetailWithoutMonitorRecord(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	appRecord := createMonitorApp(t, te, "app-test-0000001", "Demo App", "local")
	rec := te.doMonitor(t, http.MethodGet, "/api/monitor/targets/app/"+appRecord.Id, "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		HasData  bool           `json:"hasData"`
		TargetID string         `json:"targetId"`
		Status   string         `json:"status"`
		Summary  map[string]any `json:"summary"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.HasData {
		t.Fatalf("expected synthesized app response without persisted data: %s", rec.Body.String())
	}
	if resp.TargetID != appRecord.Id || resp.Status != monitor.StatusHealthy {
		t.Fatalf("unexpected synthesized app response: %s", rec.Body.String())
	}
	if resp.Summary["runtime_status"] != "running" {
		t.Fatalf("expected runtime summary in synthesized app response, got %+v", resp.Summary)
	}
}

func TestMonitorMetricsIngestWritesAllowedSeries(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, _, err := monitor.GetOrIssueAgentToken(te.app, server.Id, false)
	if err != nil {
		t.Fatal(err)
	}
	var captured []monitor.MetricPoint
	restore := monitor.SetMetricWriteFuncForTest(func(_ context.Context, points []monitor.MetricPoint) error {
		captured = append(captured, points...)
		return nil
	})
	defer restore()

	body := `{"serverId":"` + server.Id + `","reportedAt":"2026-04-14T12:00:00Z","items":[{"targetType":"server","targetId":"` + server.Id + `","series":"appos_host_cpu_usage","value":0.42,"labels":{"hostname":"prod-01"},"observedAt":"2026-04-14T12:00:00Z"}]}`
	rec := te.doMonitor(t, http.MethodPost, "/api/monitor/ingest/metrics", body, "Bearer "+token)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(captured) != 1 {
		t.Fatalf("expected 1 captured point, got %d", len(captured))
	}
	if captured[0].Series != "appos_host_cpu_usage" || captured[0].Labels["server_id"] != server.Id {
		t.Fatalf("unexpected captured metric point: %+v", captured[0])
	}
}

func TestMonitorMetricsIngestRejectsUnknownSeries(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, _, err := monitor.GetOrIssueAgentToken(te.app, server.Id, false)
	if err != nil {
		t.Fatal(err)
	}
	body := `{"serverId":"` + server.Id + `","reportedAt":"2026-04-14T12:00:00Z","items":[{"targetType":"server","targetId":"` + server.Id + `","series":"appos_unknown_metric","value":1,"observedAt":"2026-04-14T12:00:00Z"}]}`
	rec := te.doMonitor(t, http.MethodPost, "/api/monitor/ingest/metrics", body, "Bearer "+token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMonitorRuntimeStatusIngestMergesServerSummary(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	appOne := createMonitorApp(t, te, "app-1-monitor-key", "Demo App", server.Id)
	appTwo := createMonitorApp(t, te, "app-2-monitor-key", "Demo Worker", server.Id)
	token, _, err := monitor.GetOrIssueAgentToken(te.app, server.Id, false)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 4, 14, 12, 0, 0, 0, time.UTC)
	zeroFailures := 0
	if _, err := monitor.UpsertLatestStatus(te.app, monitor.LatestStatusUpsert{
		TargetType:          monitor.TargetTypeServer,
		TargetID:            server.Id,
		DisplayName:         server.GetString("name"),
		Status:              monitor.StatusHealthy,
		SignalSource:        monitor.SignalSourceAgent,
		LastTransitionAt:    now,
		LastSuccessAt:       &now,
		LastReportedAt:      &now,
		ConsecutiveFailures: &zeroFailures,
		Summary:             map[string]any{"heartbeat_state": "fresh"},
	}); err != nil {
		t.Fatal(err)
	}

	body := `{"serverId":"` + server.Id + `","reportedAt":"2026-04-14T12:05:00Z","items":[{"targetType":"server","targetId":"` + server.Id + `","runtimeState":"running","observedAt":"2026-04-14T12:05:00Z","containers":{"running":3,"restarting":1,"exited":0},"apps":[{"appId":"` + appOne.Id + `","runtimeState":"running"},{"appId":"` + appTwo.Id + `","runtimeState":"restarting"}]}]}`
	rec := te.doMonitor(t, http.MethodPost, "/api/monitor/ingest/runtime-status", body, "Bearer "+token)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	record, err := te.app.FindFirstRecordByFilter(collections.MonitorLatestStatus, "target_type = {:targetType} && target_id = {:id}", map[string]any{"targetType": monitor.TargetTypeServer, "id": server.Id})
	if err != nil {
		t.Fatal(err)
	}
	summary, err := monitor.SummaryFromRecord(record)
	if err != nil {
		t.Fatal(err)
	}
	if summary["heartbeat_state"] != "fresh" {
		t.Fatalf("expected heartbeat summary preserved, got %+v", summary)
	}
	if summary["runtime_state"] != "running" || summary["containers_running"] != float64(3) {
		t.Fatalf("expected runtime summary merged, got %+v", summary)
	}
	apps, ok := summary["apps"].([]any)
	if !ok || len(apps) != 2 {
		t.Fatalf("expected two runtime app summaries, got %+v", summary["apps"])
	}
	if record.GetString("status") != monitor.StatusHealthy {
		t.Fatalf("expected healthy status after running runtime summary, got %q", record.GetString("status"))
	}
	appRecord, err := te.app.FindFirstRecordByFilter(collections.MonitorLatestStatus, "target_type = {:targetType} && target_id = {:id}", map[string]any{"targetType": monitor.TargetTypeApp, "id": appTwo.Id})
	if err != nil {
		t.Fatal(err)
	}
	if appRecord.GetString("status") != monitor.StatusDegraded {
		t.Fatalf("expected degraded app status from runtime projection, got %q", appRecord.GetString("status"))
	}
}

func TestMonitorRuntimeStatusRejectsMismatchedTarget(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, _, err := monitor.GetOrIssueAgentToken(te.app, server.Id, false)
	if err != nil {
		t.Fatal(err)
	}
	body := `{"serverId":"` + server.Id + `","reportedAt":"2026-04-14T12:05:00Z","items":[{"targetType":"server","targetId":"other","runtimeState":"running","observedAt":"2026-04-14T12:05:00Z"}]}`
	rec := te.doMonitor(t, http.MethodPost, "/api/monitor/ingest/runtime-status", body, "Bearer "+token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMonitorTargetSeriesReturnsShortWindowData(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	restore := monitor.SetMetricQueryFuncForTest(func(_ context.Context, targetType, targetID, window string, seriesNames []string, options monitor.MetricSeriesQueryOptions) (*monitor.MetricSeriesResponse, error) {
		if targetType != monitor.TargetTypeServer || targetID != server.Id || window != "1h" {
			t.Fatalf("unexpected series query params: %s %s %s %+v", targetType, targetID, window, seriesNames)
		}
		if options.NetworkInterface != "" {
			t.Fatalf("unexpected options: %+v", options)
		}
		return &monitor.MetricSeriesResponse{
			TargetType: targetType,
			TargetID:   targetID,
			Window:     window,
			Series: []monitor.MetricSeries{{
				Name:   "cpu",
				Unit:   "percent",
				Points: [][]float64{{1713096000, 32.1}, {1713096060, 30.8}},
			}},
		}, nil
	})
	defer restore()

	rec := te.doMonitor(t, http.MethodGet, "/api/monitor/targets/server/"+server.Id+"/series?window=1h&series=cpu", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp monitor.MetricSeriesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.TargetID != server.Id || len(resp.Series) != 1 || resp.Series[0].Name != "cpu" {
		t.Fatalf("unexpected series response: %s", rec.Body.String())
	}
}

func TestMonitorAppTargetSeriesReturnsShortWindowData(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	appRecord := createMonitorApp(t, te, "app-1-monitor-key", "Demo App", "local")
	restore := monitor.SetMetricQueryFuncForTest(func(_ context.Context, targetType, targetID, window string, seriesNames []string, options monitor.MetricSeriesQueryOptions) (*monitor.MetricSeriesResponse, error) {
		if targetType != monitor.TargetTypeApp || targetID != appRecord.Id || window != "1h" {
			t.Fatalf("unexpected app series query params: %s %s %s %+v", targetType, targetID, window, seriesNames)
		}
		if options.NetworkInterface != "" {
			t.Fatalf("unexpected options: %+v", options)
		}
		return &monitor.MetricSeriesResponse{TargetType: targetType, TargetID: targetID, Window: window, Series: []monitor.MetricSeries{{Name: "memory", Unit: "bytes", Points: [][]float64{{1713096000, 104857600}}}}}, nil
	})
	defer restore()
	rec := te.doMonitor(t, http.MethodGet, "/api/monitor/targets/app/"+appRecord.Id+"/series?window=1h&series=memory", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}
