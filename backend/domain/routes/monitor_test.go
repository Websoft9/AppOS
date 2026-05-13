package routes

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitormetrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
	"github.com/websoft9/appos/backend/domain/monitor/status/store"
)

func newMonitorTestEnv(t *testing.T) *testEnv {
	t.Helper()
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

func TestMonitorWriteRequiresBasicAuth(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	rec := te.doMonitor(t, http.MethodPost, "/api/monitor/write", "remote-write-payload", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("WWW-Authenticate"); !strings.Contains(got, "AppOS monitor write") {
		t.Fatalf("expected monitor write auth challenge, got %q", got)
	}
}

func TestMonitorWriteForwardsAuthenticatedRemoteWritePayload(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, err := getOrIssueMonitorAgentToken(te.app, server.Id)
	if err != nil {
		t.Fatal(err)
	}

	var gotPath string
	var gotBody string
	var gotContentType string
	tsdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotContentType = r.Header.Get("Content-Type")
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer tsdb.Close()
	t.Setenv(monitormetrics.EnvVictoriaMetricsURL, tsdb.URL)

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}
	registerMonitorRoutes(&core.ServeEvent{App: te.app, Router: r})
	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader("remote-write-payload"))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "application/x-protobuf")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if gotPath != "/api/v1/write" {
		t.Fatalf("expected TSDB remote write path, got %q", gotPath)
	}
	if gotBody != "remote-write-payload" {
		t.Fatalf("unexpected forwarded body %q", gotBody)
	}
	if gotContentType != "application/x-protobuf" {
		t.Fatalf("expected content-type to be forwarded, got %q", gotContentType)
	}
}

func TestMonitorWriteRejectsOversizedPayload(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, err := getOrIssueMonitorAgentToken(te.app, server.Id)
	if err != nil {
		t.Fatal(err)
	}

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}
	registerMonitorRoutes(&core.ServeEvent{App: te.app, Router: r})
	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader("remote-write-payload"))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "application/x-protobuf")
	req.ContentLength = maxMonitorWriteBodyBytes + 1
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMonitorWriteRejectsStreamThatExceedsLimit(t *testing.T) {
	reader := &monitorWriteLimitReadCloser{body: io.NopCloser(strings.NewReader("abcdef")), remaining: 3}
	buf := make([]byte, 3)
	if n, err := reader.Read(buf); n != 3 || err != nil {
		t.Fatalf("expected initial limited read to succeed, n=%d err=%v", n, err)
	}
	if _, err := reader.Read(buf); !errors.Is(err, errMonitorWritePayloadTooLarge) {
		t.Fatalf("expected explicit payload-too-large error, got %v", err)
	}
}

func TestMonitorOpenAPIDocumentsWriteAndSeriesContracts(t *testing.T) {
	raw, err := os.ReadFile("../../docs/openapi/api.yaml")
	if err != nil {
		t.Fatal(err)
	}
	spec := string(raw)
	for _, want := range []string{
		"MonitorAgentDeployRequest:\n            properties:",
		"MonitorAgentDeployResponse:\n            properties:",
		"MonitorErrorResponse:\n            properties:",
		"MonitorMetricSeriesResponse:\n            properties:",
		"MonitorContainerTelemetryResponse:\n            properties:",
		"MonitorOverviewResponse:\n            properties:",
		"MonitorTargetStatusResponse:\n            properties:",
		"/api/monitor/write:",
		"name: Content-Encoding",
		"name: X-Prometheus-Remote-Write-Version",
		"application/x-protobuf:",
		"\"204\":",
		"- basicAuth: []",
		"/api/servers/{serverId}/ops/monitor-agent/install:",
		"$ref: '#/components/schemas/MonitorAgentDeployRequest'",
		"$ref: '#/components/schemas/MonitorAgentDeployResponse'",
	} {
		if !strings.Contains(spec, want) {
			t.Fatalf("expected OpenAPI spec to contain %q", want)
		}
	}
	matrixRaw, err := os.ReadFile("../../docs/openapi/group-matrix.yaml")
	if err != nil {
		t.Fatal(err)
	}
	matrix := string(matrixRaw)
	for _, want := range []string{
		"POST /api/monitor/write",
		"GET /api/monitor/overview",
		"GET /api/monitor/servers/{id}/container-telemetry",
		"GET /api/monitor/targets/{targetType}/{targetId}",
		"GET /api/monitor/targets/{targetType}/{targetId}/series",
		"POST /api/servers/{serverId}/ops/monitor-agent/install",
		"POST /api/servers/{serverId}/ops/monitor-agent/update",
		"server_monitor_agent.go",
	} {
		if !strings.Contains(matrix, want) {
			t.Fatalf("expected OpenAPI matrix to contain %q", want)
		}
	}
}

func TestMonitorOverviewReturnsProjectedOfflineStatus(t *testing.T) {
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
		Reason:              "control plane check failed",
		SignalSource:        monitor.SignalSourceAppOS,
		LastTransitionAt:    now,
		LastFailureAt:       &now,
		LastReportedAt:      &now,
		ConsecutiveFailures: &zeroFailures,
		Summary:             map[string]any{"reason_code": "control_unreachable"},
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
		SignalSource:        monitor.SignalSourceAppOS,
		LastTransitionAt:    now,
		LastSuccessAt:       &now,
		LastReportedAt:      &now,
		ConsecutiveFailures: &zeroFailures,
		Summary: map[string]any{
			"control_state": "reachable",
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
	if resp.Summary["control_state"] != "reachable" {
		t.Fatalf("expected control summary, got %+v", resp.Summary)
	}
}

func TestMonitorTargetStatusSynthesizesServerDetailWithoutMonitorRecord(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "test")

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
	if resp.Summary["monitoring_state"] != "awaiting_control_plane_pull" {
		t.Fatalf("expected control-plane pending summary, got %+v", resp.Summary)
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
