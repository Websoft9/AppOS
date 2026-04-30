package routes

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitormetrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
	agentsignals "github.com/websoft9/appos/backend/domain/monitor/signals/agent"
	"github.com/websoft9/appos/backend/domain/monitor/status/store"
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
	if err := secrets.LoadTemplatesFromDefaultPath(); err != nil {
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
	token, _, err := agentsignals.GetOrIssueAgentToken(te.app, server.Id, false)
	if err != nil {
		t.Fatal(err)
	}
	nowRaw := time.Now().UTC().Format(time.RFC3339)
	body := `{"serverId":"` + server.Id + `","agentVersion":"0.1.0","reportedAt":"` + nowRaw + `","items":[{"targetType":"server","targetId":"` + server.Id + `","status":"healthy","observedAt":"` + nowRaw + `"}]}`
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

func TestMonitorOverviewReturnsProjectedOfflineHeartbeat(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	now := time.Now().UTC()
	zeroFailures := 0
	if _, err := store.UpsertLatestStatus(te.app, store.LatestStatusUpsert{
		TargetType:          monitor.TargetTypeServer,
		TargetID:            server.Id,
		DisplayName:         server.GetString("name"),
		Status:              monitor.StatusOffline,
		Reason:              "heartbeat missing",
		SignalSource:        monitor.SignalSourceAgent,
		LastTransitionAt:    now,
		LastFailureAt:       &now,
		LastReportedAt:      &now,
		ConsecutiveFailures: &zeroFailures,
		Summary:             map[string]any{"heartbeat_state": monitor.HeartbeatStateOffline},
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
	if _, err := store.UpsertLatestStatus(te.app, store.LatestStatusUpsert{
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
	if _, _, err := agentsignals.GetOrIssueAgentToken(te.app, server.Id, false); err != nil {
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
	token, _, err := agentsignals.GetOrIssueAgentToken(te.app, server.Id, false)
	if err != nil {
		t.Fatal(err)
	}
	var captured []monitormetrics.MetricPoint
	restore := monitormetrics.SetMetricWriteFuncForTest(func(_ context.Context, points []monitormetrics.MetricPoint) error {
		captured = append(captured, points...)
		return nil
	})
	defer restore()

	nowRaw := time.Now().UTC().Format(time.RFC3339)
	body := `{"serverId":"` + server.Id + `","reportedAt":"` + nowRaw + `","items":[{"targetType":"server","targetId":"` + server.Id + `","series":"appos_host_cpu_usage","value":0.42,"labels":{"hostname":"prod-01"},"observedAt":"` + nowRaw + `"}]}`
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
	token, _, err := agentsignals.GetOrIssueAgentToken(te.app, server.Id, false)
	if err != nil {
		t.Fatal(err)
	}
	nowRaw := time.Now().UTC().Format(time.RFC3339)
	body := `{"serverId":"` + server.Id + `","reportedAt":"` + nowRaw + `","items":[{"targetType":"server","targetId":"` + server.Id + `","series":"appos_unknown_metric","value":1,"observedAt":"` + nowRaw + `"}]}`
	rec := te.doMonitor(t, http.MethodPost, "/api/monitor/ingest/metrics", body, "Bearer "+token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMonitorMetricsIngestAcceptsContainerTelemetryContract(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, _, err := agentsignals.GetOrIssueAgentToken(te.app, server.Id, false)
	if err != nil {
		t.Fatal(err)
	}
	var captured []monitormetrics.MetricPoint
	restore := monitormetrics.SetMetricWriteFuncForTest(func(_ context.Context, points []monitormetrics.MetricPoint) error {
		captured = append(captured, points...)
		return nil
	})
	defer restore()

	nowRaw := time.Now().UTC().Format(time.RFC3339)
	body := `{"serverId":"` + server.Id + `","reportedAt":"` + nowRaw + `","items":[{"targetType":"container","targetId":"ctr-1","series":"appos_container_cpu_usage","value":17.2,"labels":{"container_name":"nginx","compose_project":"demo"},"observedAt":"` + nowRaw + `"}]}`
	rec := te.doMonitor(t, http.MethodPost, "/api/monitor/ingest/metrics", body, "Bearer "+token)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(captured) != 1 {
		t.Fatalf("expected 1 captured point, got %d", len(captured))
	}
	point := captured[0]
	if point.Labels["server_id"] != server.Id || point.Labels["container_id"] != "ctr-1" {
		t.Fatalf("expected server_id and container_id labels, got %+v", point.Labels)
	}
	if point.Labels["target_type"] != monitor.TargetTypeContainer || point.Labels["target_id"] != "ctr-1" {
		t.Fatalf("expected container target labels, got %+v", point.Labels)
	}
	if point.Labels["container_name"] != "nginx" || point.Labels["compose_project"] != "demo" {
		t.Fatalf("expected optional labels preserved, got %+v", point.Labels)
	}
}

func TestMonitorMetricsIngestRejectsContainerSeriesWithoutContainerTarget(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, _, err := agentsignals.GetOrIssueAgentToken(te.app, server.Id, false)
	if err != nil {
		t.Fatal(err)
	}
	nowRaw := time.Now().UTC().Format(time.RFC3339)
	body := `{"serverId":"` + server.Id + `","reportedAt":"` + nowRaw + `","items":[{"targetType":"server","targetId":"` + server.Id + `","series":"appos_container_memory_bytes","value":1048576,"observedAt":"` + nowRaw + `"}]}`
	rec := te.doMonitor(t, http.MethodPost, "/api/monitor/ingest/metrics", body, "Bearer "+token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMonitorFactsIngestWritesServerRecord(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, _, err := agentsignals.GetOrIssueAgentToken(te.app, server.Id, false)
	if err != nil {
		t.Fatal(err)
	}
	observedAt := time.Date(2026, 4, 14, 12, 0, 0, 0, time.UTC)
	observedAtRaw := observedAt.Format(time.RFC3339)
	body := `{"serverId":"` + server.Id + `","reportedAt":"` + observedAtRaw + `","items":[{"targetType":"server","targetId":"` + server.Id + `","observedAt":"` + observedAtRaw + `","facts":{"os":{"family":"linux","distribution":"ubuntu","version":"24.04"},"kernel":{"release":"6.8.0"},"architecture":"amd64","cpu":{"cores":4},"memory":{"total_bytes":8589934592}}}]}`
	rec := te.doMonitor(t, http.MethodPost, "/api/monitor/ingest/facts", body, "Bearer "+token)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	stored, err := te.app.FindRecordById("servers", server.Id)
	if err != nil {
		t.Fatal(err)
	}
	facts := mustRouteJSONMap(t, stored.Get("facts_json"))
	if facts["architecture"] != "amd64" {
		t.Fatalf("expected architecture amd64, got %+v", facts)
	}
	osFacts := mustRouteJSONMap(t, facts["os"])
	if osFacts["distribution"] != "ubuntu" {
		t.Fatalf("expected normalized os facts, got %+v", facts)
	}
	if got := stored.GetDateTime("facts_observed_at").Time().UTC().Format(time.RFC3339); got != observedAtRaw {
		t.Fatalf("expected facts_observed_at %q, got %q", observedAtRaw, got)
	}
}

func TestMonitorFactsIngestRejectsOwnershipMismatch(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	other := createMonitorServer(t, te, "prod-02")
	token, _, err := agentsignals.GetOrIssueAgentToken(te.app, server.Id, false)
	if err != nil {
		t.Fatal(err)
	}
	nowRaw := time.Now().UTC().Format(time.RFC3339)
	body := `{"serverId":"` + other.Id + `","reportedAt":"` + nowRaw + `","items":[{"targetType":"server","targetId":"` + other.Id + `","facts":{"architecture":"amd64"}}]}`
	rec := te.doMonitor(t, http.MethodPost, "/api/monitor/ingest/facts", body, "Bearer "+token)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMonitorFactsIngestRejectsAllowlistViolation(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, _, err := agentsignals.GetOrIssueAgentToken(te.app, server.Id, false)
	if err != nil {
		t.Fatal(err)
	}
	nowRaw := time.Now().UTC().Format(time.RFC3339)
	body := `{"serverId":"` + server.Id + `","reportedAt":"` + nowRaw + `","items":[{"targetType":"server","targetId":"` + server.Id + `","facts":{"os":{"family":"linux"},"netdata":{"plugin":"system-info"}}}]}`
	rec := te.doMonitor(t, http.MethodPost, "/api/monitor/ingest/facts", body, "Bearer "+token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMonitorFactsIngestReplacesPreviousSnapshot(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, _, err := agentsignals.GetOrIssueAgentToken(te.app, server.Id, false)
	if err != nil {
		t.Fatal(err)
	}
	firstAt := time.Date(2026, 4, 14, 12, 0, 0, 0, time.UTC).Format(time.RFC3339)
	secondAt := time.Date(2026, 4, 14, 12, 5, 0, 0, time.UTC).Format(time.RFC3339)
	firstBody := `{"serverId":"` + server.Id + `","reportedAt":"` + firstAt + `","items":[{"targetType":"server","targetId":"` + server.Id + `","facts":{"os":{"family":"linux","distribution":"ubuntu"},"kernel":{"release":"6.8.0"}}}]}`
	if rec := te.doMonitor(t, http.MethodPost, "/api/monitor/ingest/facts", firstBody, "Bearer "+token); rec.Code != http.StatusAccepted {
		t.Fatalf("expected first request 202, got %d: %s", rec.Code, rec.Body.String())
	}
	secondBody := `{"serverId":"` + server.Id + `","reportedAt":"` + secondAt + `","items":[{"targetType":"server","targetId":"` + server.Id + `","facts":{"architecture":"arm64","cpu":{"cores":8}}}]}`
	if rec := te.doMonitor(t, http.MethodPost, "/api/monitor/ingest/facts", secondBody, "Bearer "+token); rec.Code != http.StatusAccepted {
		t.Fatalf("expected second request 202, got %d: %s", rec.Code, rec.Body.String())
	}
	stored, err := te.app.FindRecordById("servers", server.Id)
	if err != nil {
		t.Fatal(err)
	}
	facts := mustRouteJSONMap(t, stored.Get("facts_json"))
	if _, ok := facts["os"]; ok {
		t.Fatalf("expected replaced facts snapshot without os, got %+v", facts)
	}
	if facts["architecture"] != "arm64" {
		t.Fatalf("expected replaced facts snapshot, got %+v", facts)
	}
}

func TestMonitorFactsIngestRejectsBatchLargerThanOne(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, _, err := agentsignals.GetOrIssueAgentToken(te.app, server.Id, false)
	if err != nil {
		t.Fatal(err)
	}
	nowRaw := time.Now().UTC().Format(time.RFC3339)
	body := `{"serverId":"` + server.Id + `","reportedAt":"` + nowRaw + `","items":[{"targetType":"server","targetId":"` + server.Id + `","facts":{"architecture":"amd64"}},{"targetType":"server","targetId":"` + server.Id + `","facts":{"architecture":"arm64"}}]}`
	rec := te.doMonitor(t, http.MethodPost, "/api/monitor/ingest/facts", body, "Bearer "+token)
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
	token, _, err := agentsignals.GetOrIssueAgentToken(te.app, server.Id, false)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 4, 14, 12, 0, 0, 0, time.UTC)
	zeroFailures := 0
	if _, err := store.UpsertLatestStatus(te.app, store.LatestStatusUpsert{
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

	observedAtRaw := now.Add(5 * time.Minute).Format(time.RFC3339)
	body := `{"serverId":"` + server.Id + `","reportedAt":"` + observedAtRaw + `","items":[{"targetType":"server","targetId":"` + server.Id + `","runtimeState":"running","observedAt":"` + observedAtRaw + `","containers":{"running":3,"restarting":1,"exited":0},"apps":[{"appId":"` + appOne.Id + `","runtimeState":"running"},{"appId":"` + appTwo.Id + `","runtimeState":"restarting"}]}]}`
	rec := te.doMonitor(t, http.MethodPost, "/api/monitor/ingest/runtime-status", body, "Bearer "+token)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	record, err := te.app.FindFirstRecordByFilter(collections.MonitorLatestStatus, "target_type = {:targetType} && target_id = {:id}", map[string]any{"targetType": monitor.TargetTypeServer, "id": server.Id})
	if err != nil {
		t.Fatal(err)
	}
	summary, err := store.SummaryFromRecord(record)
	if err != nil {
		t.Fatal(err)
	}
	if summary["heartbeat_state"] != "fresh" {
		t.Fatalf("expected heartbeat summary preserved, got %+v", summary)
	}
	if _, ok := summary["reason_code"]; ok {
		t.Fatalf("expected healthy server runtime summary to omit reason_code, got %+v", summary)
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
	appSummary, err := store.SummaryFromRecord(appRecord)
	if err != nil {
		t.Fatal(err)
	}
	if appSummary["reason_code"] != "app_runtime_unhealthy" {
		t.Fatalf("expected app_runtime_unhealthy reason_code, got %+v", appSummary)
	}
}

func TestMonitorRuntimeStatusRejectsMismatchedTarget(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, _, err := agentsignals.GetOrIssueAgentToken(te.app, server.Id, false)
	if err != nil {
		t.Fatal(err)
	}
	nowRaw := time.Now().UTC().Format(time.RFC3339)
	body := `{"serverId":"` + server.Id + `","reportedAt":"` + nowRaw + `","items":[{"targetType":"server","targetId":"other","runtimeState":"running","observedAt":"` + nowRaw + `"}]}`
	rec := te.doMonitor(t, http.MethodPost, "/api/monitor/ingest/runtime-status", body, "Bearer "+token)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMonitorTargetSeriesReturnsShortWindowData(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	restore := monitormetrics.SetMetricQueryFuncForTest(func(_ context.Context, targetType, targetID, window string, seriesNames []string, options monitormetrics.MetricSeriesQueryOptions) (*monitormetrics.MetricSeriesResponse, error) {
		if targetType != monitor.TargetTypeServer || targetID != server.Id || window != "1h" {
			t.Fatalf("unexpected series query params: %s %s %s %+v", targetType, targetID, window, seriesNames)
		}
		if options.NetworkInterface != "" {
			t.Fatalf("unexpected options: %+v", options)
		}
		return &monitormetrics.MetricSeriesResponse{
			TargetType: targetType,
			TargetID:   targetID,
			Window:     window,
			Series: []monitormetrics.MetricSeries{{
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
	var resp monitormetrics.MetricSeriesResponse
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
	restore := monitormetrics.SetMetricQueryFuncForTest(func(_ context.Context, targetType, targetID, window string, seriesNames []string, options monitormetrics.MetricSeriesQueryOptions) (*monitormetrics.MetricSeriesResponse, error) {
		if targetType != monitor.TargetTypeApp || targetID != appRecord.Id || window != "1h" {
			t.Fatalf("unexpected app series query params: %s %s %s %+v", targetType, targetID, window, seriesNames)
		}
		if options.NetworkInterface != "" {
			t.Fatalf("unexpected options: %+v", options)
		}
		return &monitormetrics.MetricSeriesResponse{TargetType: targetType, TargetID: targetID, Window: window, Series: []monitormetrics.MetricSeries{{Name: "memory", Unit: "bytes", Points: [][]float64{{1713096000, 104857600}}}}}, nil
	})
	defer restore()
	rec := te.doMonitor(t, http.MethodGet, "/api/monitor/targets/app/"+appRecord.Id+"/series?window=1h&series=memory", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMonitorTargetSeriesParsesCustomRange(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-custom")
	startAt := "2026-04-14T08:00:00Z"
	endAt := "2026-04-14T20:00:00Z"
	restore := monitormetrics.SetMetricQueryFuncForTest(func(_ context.Context, targetType, targetID, window string, seriesNames []string, options monitormetrics.MetricSeriesQueryOptions) (*monitormetrics.MetricSeriesResponse, error) {
		if targetType != monitor.TargetTypeServer || targetID != server.Id || window != "custom" {
			t.Fatalf("unexpected custom series query params: %s %s %s %+v", targetType, targetID, window, seriesNames)
		}
		if options.StartAt == nil || options.EndAt == nil {
			t.Fatalf("expected custom range options, got %+v", options)
		}
		if options.StartAt.Format(time.RFC3339) != startAt || options.EndAt.Format(time.RFC3339) != endAt {
			t.Fatalf("unexpected custom range values: %+v", options)
		}
		return &monitormetrics.MetricSeriesResponse{
			TargetType:   targetType,
			TargetID:     targetID,
			Window:       window,
			RangeStartAt: startAt,
			RangeEndAt:   endAt,
			StepSeconds:  600,
			Series: []monitormetrics.MetricSeries{{
				Name:   "cpu",
				Unit:   "percent",
				Points: [][]float64{{1713081600, 12.1}, {1713124800, 18.4}},
			}},
		}, nil
	})
	defer restore()

	rec := te.doMonitor(t, http.MethodGet, "/api/monitor/targets/server/"+server.Id+"/series?window=custom&series=cpu&startAt="+url.QueryEscape(startAt)+"&endAt="+url.QueryEscape(endAt), "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMonitorServerContainerTelemetryReturnsServerScopedItems(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	restore := monitormetrics.SetContainerTelemetryQueryFuncForTest(func(_ context.Context, serverID string, containerIDs []string, window string) (*monitormetrics.ContainerTelemetryResponse, error) {
		if serverID != server.Id {
			t.Fatalf("unexpected server id: %s", serverID)
		}
		if window != "15m" {
			t.Fatalf("unexpected window: %s", window)
		}
		if len(containerIDs) != 2 || containerIDs[0] != "ctr-1" || containerIDs[1] != "ctr-2" {
			t.Fatalf("unexpected container ids: %+v", containerIDs)
		}
		cpu := 22.5
		memory := 134217728.0
		return &monitormetrics.ContainerTelemetryResponse{
			ServerID:     serverID,
			Window:       window,
			RangeStartAt: "2026-04-14T11:45:00Z",
			RangeEndAt:   "2026-04-14T12:00:00Z",
			StepSeconds:  30,
			Items: []monitormetrics.ContainerTelemetryItem{{
				ContainerID:   "ctr-1",
				ContainerName: "demo-web",
				Latest: monitormetrics.ContainerTelemetryLatest{
					CPUPercent:  &cpu,
					MemoryBytes: &memory,
				},
				Freshness: monitormetrics.ContainerTelemetryFreshness{
					State:      "fresh",
					ObservedAt: "2026-04-14T12:00:00Z",
				},
			}},
		}, nil
	})
	defer restore()

	rec := te.doMonitor(t, http.MethodGet, "/api/monitor/servers/"+server.Id+"/container-telemetry?window=15m&containerId=ctr-1&containerId=ctr-2", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp monitormetrics.ContainerTelemetryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.ServerID != server.Id || len(resp.Items) != 1 || resp.Items[0].ContainerID != "ctr-1" {
		t.Fatalf("unexpected telemetry response: %s", rec.Body.String())
	}
}
