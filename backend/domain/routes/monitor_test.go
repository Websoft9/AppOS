package routes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

	rec := te.doMonitor(t, http.MethodPost, "/api/monitor/write", "cpu,host=test usage_idle=91.5", "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("WWW-Authenticate"); !strings.Contains(got, "AppOS monitor write") {
		t.Fatalf("expected monitor write auth challenge, got %q", got)
	}
}

func TestMonitorWriteForwardsAuthenticatedInfluxPayload(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-telegraf")
	token, err := getOrIssueMonitorCollectorToken(te.app, server.Id)
	if err != nil {
		t.Fatal(err)
	}

	var gotPath string
	var gotBody string
	var gotStreamMode string
	tsdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotStreamMode = r.Header.Get("Stream-Mode")
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
	payload := "docker_container,appos_server_id=srv-1 container_cpu_usage=42.5"
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader(payload))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "text/plain; charset=utf-8")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if gotPath != "/write" {
		t.Fatalf("expected VictoriaMetrics influx write path /write, got %q", gotPath)
	}
	if gotBody != payload {
		t.Fatalf("expected forwarded payload %q, got %q", payload, gotBody)
	}
	if gotStreamMode != "1" {
		t.Fatalf("expected Stream-Mode=1, got %q", gotStreamMode)
	}
}

func TestMonitorWriteAlsoProjectsCanonicalMetrics(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()
	telegrafCanonicalProjectionCache.reset()

	server := createMonitorServer(t, te, "prod-telegraf-canonical")
	token, err := getOrIssueMonitorCollectorToken(te.app, server.Id)
	if err != nil {
		t.Fatal(err)
	}

	var gotBody string
	tsdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer tsdb.Close()
	t.Setenv(monitormetrics.EnvVictoriaMetricsURL, tsdb.URL)

	baseTimestamp := int64(1776168000)
	payload := strings.Join([]string{
		fmt.Sprintf("cpu,appos_server_id=%s,cpu=cpu-total usage_idle=80 %d", server.Id, baseTimestamp),
		fmt.Sprintf("mem,appos_server_id=%s used=1048576i,available=2097152i %d", server.Id, baseTimestamp),
		fmt.Sprintf("disk,appos_server_id=%s,path=/ used=4096i,free=8192i %d", server.Id, baseTimestamp),
		fmt.Sprintf("net,appos_server_id=%s,interface=eth0 bytes_recv=100i,bytes_sent=200i %d", server.Id, baseTimestamp),
		fmt.Sprintf("diskio,appos_server_id=%s,name=sda read_bytes=1000i,write_bytes=3000i %d", server.Id, baseTimestamp),
		fmt.Sprintf("docker_container_cpu,appos_server_id=%s,cpu=cpu-total,container_name=demo-web usage_percent=12.5,container_id=\"ctr-1\" %d", server.Id, baseTimestamp),
		fmt.Sprintf("docker_container_mem,appos_server_id=%s,container_name=demo-web usage=2048i,limit=4096i,container_id=\"ctr-1\" %d", server.Id, baseTimestamp),
		fmt.Sprintf("docker_container_net,appos_server_id=%s,container_name=demo-web,network=eth0 rx_bytes=100i,tx_bytes=50i,container_id=\"ctr-1\" %d", server.Id, baseTimestamp),
		fmt.Sprintf("docker_container_blkio,appos_server_id=%s,container_name=demo-web,device=8:0 io_service_bytes_recursive_read=100i,io_service_bytes_recursive_write=50i,container_id=\"ctr-1\" %d", server.Id, baseTimestamp),
		fmt.Sprintf("net,appos_server_id=%s,interface=eth0 bytes_recv=130i,bytes_sent=260i %d", server.Id, baseTimestamp+10),
		fmt.Sprintf("diskio,appos_server_id=%s,name=sda read_bytes=1100i,write_bytes=3050i %d", server.Id, baseTimestamp+10),
		fmt.Sprintf("docker_container_net,appos_server_id=%s,container_name=demo-web,network=eth0 rx_bytes=140i,tx_bytes=70i,container_id=\"ctr-1\" %d", server.Id, baseTimestamp+10),
		fmt.Sprintf("docker_container_blkio,appos_server_id=%s,container_name=demo-web,device=8:0 io_service_bytes_recursive_read=140i,io_service_bytes_recursive_write=80i,container_id=\"ctr-1\" %d", server.Id, baseTimestamp+10),
	}, "\n")

	var wrotePoints []monitormetrics.MetricPoint
	restoreWrite := monitormetrics.SetMetricWriteFuncForTest(func(_ context.Context, points []monitormetrics.MetricPoint) error {
		wrotePoints = append([]monitormetrics.MetricPoint(nil), points...)
		return nil
	})
	defer restoreWrite()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}
	registerMonitorRoutes(&core.ServeEvent{App: te.app, Router: r})
	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader(payload))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "text/plain; charset=utf-8")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if gotBody != payload {
		t.Fatalf("expected raw payload forwarded, got %q", gotBody)
	}
	if len(wrotePoints) == 0 {
		t.Fatal("expected canonical metric points to be projected from collector payload")
	}
	seen := make(map[string]monitormetrics.MetricPoint, len(wrotePoints))
	for _, point := range wrotePoints {
		seen[point.Series+"\x00"+point.Labels["target_type"]+"\x00"+point.Labels["target_id"]+"\x00"+point.Labels["network_interface"]] = point
	}
	if got := seen["appos_host_cpu_usage\x00server\x00"+server.Id+"\x00"].Value; got != 20 {
		t.Fatalf("expected projected host cpu usage 20, got %+v", wrotePoints)
	}
	if got := seen["appos_host_memory_bytes\x00server\x00"+server.Id+"\x00"].Value; got != 1048576 {
		t.Fatalf("expected projected host memory bytes, got %+v", wrotePoints)
	}
	if got := seen["appos_host_disk_read_bytes_per_second\x00server\x00"+server.Id+"\x00"].Value; got != 10 {
		t.Fatalf("expected projected host disk read rate 10, got %+v", wrotePoints)
	}
	if got := seen["appos_host_network_rx_bytes_per_second\x00server\x00"+server.Id+"\x00eth0"].Value; got != 3 {
		t.Fatalf("expected projected host interface rx rate 3, got %+v", wrotePoints)
	}
	if got := seen["appos_host_network_rx_bytes_per_second\x00server\x00"+server.Id+"\x00"].Value; got != 3 {
		t.Fatalf("expected projected host aggregate rx rate 3, got %+v", wrotePoints)
	}
	if got := seen["appos_container_cpu_usage_percent\x00container\x00demo-web\x00"].Value; got != 12.5 {
		t.Fatalf("expected projected container cpu usage 12.5, got %+v", wrotePoints)
	}
	if got := seen["appos_container_memory_limit_bytes\x00container\x00demo-web\x00"].Value; got != 4096 {
		t.Fatalf("expected projected container memory limit, got %+v", wrotePoints)
	}
	if got := seen["appos_container_network_receive_bytes_per_second\x00container\x00demo-web\x00"].Value; got != 4 {
		t.Fatalf("expected projected container rx rate 4, got %+v", wrotePoints)
	}
	if got := seen["appos_container_block_write_bytes_per_second\x00container\x00demo-web\x00"].Value; got != 3 {
		t.Fatalf("expected projected container block write rate 3, got %+v", wrotePoints)
	}
}

func TestMonitorWriteRejectsOversizedPayload(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, err := getOrIssueMonitorCollectorToken(te.app, server.Id)
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
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader("cpu,appos_server_id=srv-1 usage_idle=90"))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "text/plain; charset=utf-8")
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
		"MonitorErrorResponse:\n            properties:",
		"MonitorMetricSeriesResponse:\n            properties:",
		"MonitorContainerTelemetryResponse:\n            properties:",
		"MonitorOverviewResponse:\n            properties:",
		"MonitorTargetStatusResponse:\n            properties:",
		"/api/monitor/write:",
		"Basic base64(serverId:monitorCollectorToken)",
		"text/plain:",
		"\"204\":",
		"- basicAuth: []",
	} {
		if !strings.Contains(spec, want) {
			t.Fatalf("expected OpenAPI spec to contain %q", want)
		}
	}
	for _, unwanted := range []string{
		"/api/monitor/telegraf/write:",
		"/api/servers/{serverId}/ops/monitor-agent/install:",
		"monitorAgentToken",
		"monitor-agent deployment",
		"application/x-protobuf:",
		"name: Content-Encoding",
		"name: X-Prometheus-Remote-Write-Version",
	} {
		if strings.Contains(spec, unwanted) {
			t.Fatalf("expected OpenAPI spec to drop %q", unwanted)
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
	} {
		if !strings.Contains(matrix, want) {
			t.Fatalf("expected OpenAPI matrix to contain %q", want)
		}
	}
	for _, unwanted := range []string{
		"POST /api/monitor/telegraf/write",
		"POST /api/servers/{serverId}/ops/monitor-agent/install",
		"POST /api/servers/{serverId}/ops/monitor-agent/update",
		"monitor-agent deployment",
		"server_monitor_agent.go",
	} {
		if strings.Contains(matrix, unwanted) {
			t.Fatalf("expected OpenAPI matrix to drop %q", unwanted)
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

func TestMonitorTargetLatestReturnsIndependentLatestMetrics(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-latest")
	restore := monitormetrics.SetMetricLatestQueryFuncForTest(func(_ context.Context, targetType, targetID string, seriesNames []string, options monitormetrics.MetricSeriesQueryOptions) (*monitormetrics.MetricLatestResponse, error) {
		if targetType != monitor.TargetTypeServer || targetID != server.Id {
			t.Fatalf("unexpected latest query params: %s %s %+v", targetType, targetID, seriesNames)
		}
		if len(seriesNames) != 1 || seriesNames[0] != "cpu,network" {
			t.Fatalf("unexpected requested series: %+v", seriesNames)
		}
		if options.NetworkInterface != "eth0" {
			t.Fatalf("unexpected options: %+v", options)
		}
		return &monitormetrics.MetricLatestResponse{
			TargetType:     targetType,
			TargetID:       targetID,
			CadenceSeconds: 10,
			Series: []monitormetrics.MetricSeries{{
				Name:   "cpu",
				Unit:   "percent",
				Points: [][]float64{{1713096060, 30.8}},
			}},
			AvailableNetworkInterfaces: []string{"eth0"},
			SelectedNetworkInterface:   "eth0",
		}, nil
	})
	defer restore()

	rec := te.doMonitor(t, http.MethodGet, "/api/monitor/targets/server/"+server.Id+"/latest?series=cpu%2Cnetwork&networkInterface=eth0", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp monitormetrics.MetricLatestResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.TargetID != server.Id || resp.CadenceSeconds != 10 || len(resp.Series) != 1 {
		t.Fatalf("unexpected latest response: %s", rec.Body.String())
	}
}

func TestMonitorServerContainerTelemetryReturnsServerScopedItems(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	restore := monitormetrics.SetContainerTelemetryQueryFuncForTest(func(_ context.Context, serverID string, targets []monitormetrics.ContainerTelemetryTarget, window string) (*monitormetrics.ContainerTelemetryResponse, error) {
		if serverID != server.Id {
			t.Fatalf("unexpected server id: %s", serverID)
		}
		if window != "15m" {
			t.Fatalf("unexpected window: %s", window)
		}
		if len(targets) != 2 || targets[0].ID != "ctr-1" || targets[0].Name != "demo-web" || targets[1].ID != "ctr-2" || targets[1].Name != "demo-worker" {
			t.Fatalf("unexpected container telemetry targets: %+v", targets)
		}
		cpu := 22.5
		memoryUsage := 134217728.0
		memoryLimit := 268435456.0
		networkRx := 2048.0
		blockRead := 4096.0
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
					CPUPercent:              &cpu,
					MemoryUsageBytes:        &memoryUsage,
					MemoryLimitBytes:        &memoryLimit,
					NetworkRxBytesPerSecond: &networkRx,
					BlockReadBytesPerSecond: &blockRead,
				},
				Freshness: monitormetrics.ContainerTelemetryFreshness{
					State:      "fresh",
					ObservedAt: "2026-04-14T12:00:00Z",
				},
			}},
		}, nil
	})
	defer restore()

	rec := te.doMonitor(t, http.MethodGet, "/api/monitor/servers/"+server.Id+"/container-telemetry?window=15m&containerId=ctr-1&containerName=demo-web&containerId=ctr-2&containerName=demo-worker", "", te.token)
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

func TestMonitorServerContainerTelemetryAllowsLocalSyntheticServerID(t *testing.T) {
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	restore := monitormetrics.SetContainerTelemetryQueryFuncForTest(func(_ context.Context, serverID string, targets []monitormetrics.ContainerTelemetryTarget, window string) (*monitormetrics.ContainerTelemetryResponse, error) {
		if serverID != "local" {
			t.Fatalf("unexpected server id: %s", serverID)
		}
		if len(targets) != 1 || targets[0].ID != "ctr-local-1" || targets[0].Name != "demo-web" {
			t.Fatalf("unexpected container telemetry targets: %+v", targets)
		}
		return &monitormetrics.ContainerTelemetryResponse{
			ServerID: serverID,
			Window:   window,
			Items: []monitormetrics.ContainerTelemetryItem{{
				ContainerID:   "ctr-local-1",
				ContainerName: "demo-web",
			}},
		}, nil
	})
	defer restore()

	rec := te.doMonitor(t, http.MethodGet, "/api/monitor/servers/local/container-telemetry?window=15m&containerId=ctr-local-1&containerName=demo-web", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp monitormetrics.ContainerTelemetryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.ServerID != "local" || len(resp.Items) != 1 || resp.Items[0].ContainerID != "ctr-local-1" {
		t.Fatalf("unexpected telemetry response: %s", rec.Body.String())
	}
}
