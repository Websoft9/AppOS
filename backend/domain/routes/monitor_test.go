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
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/gogo/protobuf/proto"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/prometheus/prometheus/prompb"
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

	t.Setenv(monitormetrics.EnvVictoriaMetricsURL, "http://vm.example.test")

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
}

func TestMonitorWriteAlsoProjectsCanonicalServerMetrics(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, err := getOrIssueMonitorAgentToken(te.app, server.Id)
	if err != nil {
		t.Fatal(err)
	}

	payload, err := proto.Marshal(&prompb.WriteRequest{Timeseries: []prompb.TimeSeries{{
		Labels:  []prompb.Label{{Name: "__name__", Value: "netdata_system_cpu_percentage_average"}, {Name: "instance", Value: server.Id}, {Name: "dimension", Value: "idle"}},
		Samples: []prompb.Sample{{Value: 78.5, Timestamp: 1776168000000}},
	}}})
	if err != nil {
		t.Fatal(err)
	}

	t.Setenv(monitormetrics.EnvVictoriaMetricsURL, "http://vm.example.test")

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
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader(string(payload)))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "application/x-protobuf")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(wrotePoints) != 1 {
		t.Fatalf("expected one canonical metric point, got %+v", wrotePoints)
	}
	if wrotePoints[0].Series != "appos_host_cpu_usage" {
		t.Fatalf("expected canonical host cpu series, got %+v", wrotePoints[0])
	}
	if wrotePoints[0].Value != 21.5 {
		t.Fatalf("expected cpu usage 21.5, got %+v", wrotePoints[0])
	}
	if wrotePoints[0].Labels["server_id"] != server.Id || wrotePoints[0].Labels["target_type"] != monitor.TargetTypeServer || wrotePoints[0].Labels["target_id"] != server.Id {
		t.Fatalf("unexpected canonical labels: %+v", wrotePoints[0].Labels)
	}
	if !wrotePoints[0].ObservedAt.Equal(time.UnixMilli(1776168000000).UTC()) {
		t.Fatalf("unexpected observedAt: %s", wrotePoints[0].ObservedAt)
	}
}

func TestMonitorWriteAlsoProjectsCanonicalServerMemoryMetric(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, err := getOrIssueMonitorAgentToken(te.app, server.Id)
	if err != nil {
		t.Fatal(err)
	}

	payload, err := proto.Marshal(&prompb.WriteRequest{Timeseries: []prompb.TimeSeries{{
		Labels:  []prompb.Label{{Name: "__name__", Value: "netdata_system_ram_MiB_average"}, {Name: "instance", Value: server.Id}, {Name: "dimension", Value: "used"}},
		Samples: []prompb.Sample{{Value: 512, Timestamp: 1776168000000}},
	}}})
	if err != nil {
		t.Fatal(err)
	}

	tsdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer tsdb.Close()
	t.Setenv(monitormetrics.EnvVictoriaMetricsURL, tsdb.URL)

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
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader(string(payload)))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "application/x-protobuf")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(wrotePoints) != 1 {
		t.Fatalf("expected one canonical metric point, got %+v", wrotePoints)
	}
	if wrotePoints[0].Series != "appos_host_memory_bytes" {
		t.Fatalf("expected canonical host memory series, got %+v", wrotePoints[0])
	}
	if wrotePoints[0].Value != 512*1024*1024 {
		t.Fatalf("expected memory bytes conversion, got %+v", wrotePoints[0])
	}
}

func TestMonitorWriteAlsoProjectsCanonicalServerDiskMetric(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, err := getOrIssueMonitorAgentToken(te.app, server.Id)
	if err != nil {
		t.Fatal(err)
	}

	payload, err := proto.Marshal(&prompb.WriteRequest{Timeseries: []prompb.TimeSeries{{
		Labels:  []prompb.Label{{Name: "__name__", Value: "netdata_disk_space_GiB_average"}, {Name: "instance", Value: server.Id}, {Name: "family", Value: "/"}, {Name: "dimension", Value: "used"}},
		Samples: []prompb.Sample{{Value: 10.5, Timestamp: 1776168000000}},
	}}})
	if err != nil {
		t.Fatal(err)
	}

	tsdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer tsdb.Close()
	t.Setenv(monitormetrics.EnvVictoriaMetricsURL, tsdb.URL)

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
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader(string(payload)))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "application/x-protobuf")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(wrotePoints) != 1 {
		t.Fatalf("expected one canonical metric point, got %+v", wrotePoints)
	}
	if wrotePoints[0].Series != "appos_host_disk_usage_bytes" {
		t.Fatalf("expected canonical host disk series, got %+v", wrotePoints[0])
	}
	if wrotePoints[0].Value != 10.5*1024*1024*1024 {
		t.Fatalf("expected disk usage bytes conversion, got %+v", wrotePoints[0])
	}
}

func TestMonitorWriteAlsoProjectsCanonicalServerNetworkMetrics(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, err := getOrIssueMonitorAgentToken(te.app, server.Id)
	if err != nil {
		t.Fatal(err)
	}

	payload, err := proto.Marshal(&prompb.WriteRequest{Timeseries: []prompb.TimeSeries{
		{
			Labels:  []prompb.Label{{Name: "__name__", Value: "netdata_system_net_kilobits_persec_average"}, {Name: "instance", Value: server.Id}, {Name: "dimension", Value: "received"}},
			Samples: []prompb.Sample{{Value: 8, Timestamp: 1776168000000}},
		},
		{
			Labels:  []prompb.Label{{Name: "__name__", Value: "netdata_system_net_kilobits_persec_average"}, {Name: "instance", Value: server.Id}, {Name: "dimension", Value: "sent"}},
			Samples: []prompb.Sample{{Value: 4, Timestamp: 1776168000000}},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}

	tsdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer tsdb.Close()
	t.Setenv(monitormetrics.EnvVictoriaMetricsURL, tsdb.URL)

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
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader(string(payload)))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "application/x-protobuf")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(wrotePoints) != 2 {
		t.Fatalf("expected two canonical metric points, got %+v", wrotePoints)
	}
	if wrotePoints[0].Series != "appos_host_network_rx_bytes_per_second" || wrotePoints[0].Value != 1000 {
		t.Fatalf("unexpected receive metric %+v", wrotePoints[0])
	}
	if wrotePoints[1].Series != "appos_host_network_tx_bytes_per_second" || wrotePoints[1].Value != 500 {
		t.Fatalf("unexpected transmit metric %+v", wrotePoints[1])
	}
}

func TestMonitorWriteNormalizesNegativeCanonicalServerNetworkTransmitMetric(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, err := getOrIssueMonitorAgentToken(te.app, server.Id)
	if err != nil {
		t.Fatal(err)
	}

	payload, err := proto.Marshal(&prompb.WriteRequest{Timeseries: []prompb.TimeSeries{{
		Labels:  []prompb.Label{{Name: "__name__", Value: "netdata_system_net_kilobits_persec_average"}, {Name: "instance", Value: server.Id}, {Name: "dimension", Value: "sent"}},
		Samples: []prompb.Sample{{Value: -4, Timestamp: 1776168000000}},
	}}})
	if err != nil {
		t.Fatal(err)
	}

	tsdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer tsdb.Close()
	t.Setenv(monitormetrics.EnvVictoriaMetricsURL, tsdb.URL)

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
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader(string(payload)))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "application/x-protobuf")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(wrotePoints) != 1 {
		t.Fatalf("expected one canonical metric point, got %+v", wrotePoints)
	}
	if wrotePoints[0].Series != "appos_host_network_tx_bytes_per_second" || wrotePoints[0].Value != 500 {
		t.Fatalf("unexpected normalized transmit metric %+v", wrotePoints[0])
	}
}

func TestMonitorWriteAlsoProjectsCanonicalContainerCPUMetricWhenContainerIDExists(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, err := getOrIssueMonitorAgentToken(te.app, server.Id)
	if err != nil {
		t.Fatal(err)
	}

	payload, err := proto.Marshal(&prompb.WriteRequest{Timeseries: []prompb.TimeSeries{{
		Labels:  []prompb.Label{{Name: "__name__", Value: "netdata_cgroup_cpu_limit_percentage_average"}, {Name: "instance", Value: server.Id}, {Name: "dimension", Value: "used"}, {Name: "container_id", Value: "ctr-1"}, {Name: "container_name", Value: "demo-web"}, {Name: "compose_project", Value: "demo"}, {Name: "compose_service", Value: "web"}},
		Samples: []prompb.Sample{{Value: 17.2, Timestamp: 1776168000000}},
	}}})
	if err != nil {
		t.Fatal(err)
	}

	tsdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer tsdb.Close()
	t.Setenv(monitormetrics.EnvVictoriaMetricsURL, tsdb.URL)

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
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader(string(payload)))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "application/x-protobuf")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(wrotePoints) != 1 {
		t.Fatalf("expected one canonical metric point, got %+v", wrotePoints)
	}
	if wrotePoints[0].Series != "appos_container_cpu_usage_percent" {
		t.Fatalf("expected canonical container cpu series, got %+v", wrotePoints[0])
	}
	if wrotePoints[0].Labels["container_id"] != "demo-web" || wrotePoints[0].Labels["target_id"] != "demo-web" {
		t.Fatalf("unexpected container labels: %+v", wrotePoints[0].Labels)
	}
	if wrotePoints[0].Labels["compose_project"] != "demo" || wrotePoints[0].Labels["compose_service"] != "web" {
		t.Fatalf("expected compose labels, got %+v", wrotePoints[0].Labels)
	}
	if wrotePoints[0].Value != 17.2 {
		t.Fatalf("unexpected cpu value %+v", wrotePoints[0])
	}
}

func TestProjectRemoteWriteMetricPointsWarnsWhenContainerIdentityIsMissing(t *testing.T) {
	payload, err := proto.Marshal(&prompb.WriteRequest{Timeseries: []prompb.TimeSeries{
		{
			Labels: []prompb.Label{{Name: "__name__", Value: "netdata_system_cpu_percentage_average"}, {Name: "instance", Value: "srv-1"}, {Name: "dimension", Value: "idle"}},
			Samples: []prompb.Sample{{Value: 82.8, Timestamp: 1776168000000}},
		},
		{
			Labels: []prompb.Label{{Name: "__name__", Value: "netdata_cgroup_mem_usage_MiB_average"}, {Name: "instance", Value: "srv-1"}, {Name: "dimension", Value: "ram"}},
			Samples: []prompb.Sample{{Value: 128, Timestamp: 1776168000000}},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}

	points, projectionErr := projectRemoteWriteMetricPoints(payload, "", "srv-1")
	if projectionErr == nil {
		t.Fatal("expected projection warning for missing container identity")
	}
	if !strings.Contains(projectionErr.Error(), "missing") && !strings.Contains(projectionErr.Error(), "without stable container identity") {
		t.Fatalf("unexpected projection warning: %v", projectionErr)
	}
	if len(points) != 1 {
		t.Fatalf("expected one valid projected point, got %+v", points)
	}
	if points[0].Series != "appos_host_cpu_usage" {
		t.Fatalf("expected host cpu canonical point, got %+v", points[0])
	}
}

func TestMonitorWritePersistsValidCanonicalPointsEvenWhenProjectionWarns(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, err := getOrIssueMonitorAgentToken(te.app, server.Id)
	if err != nil {
		t.Fatal(err)
	}

	payload, err := proto.Marshal(&prompb.WriteRequest{Timeseries: []prompb.TimeSeries{
		{
			Labels: []prompb.Label{{Name: "__name__", Value: "netdata_system_cpu_percentage_average"}, {Name: "instance", Value: server.Id}, {Name: "dimension", Value: "idle"}},
			Samples: []prompb.Sample{{Value: 83, Timestamp: 1776168000000}},
		},
		{
			Labels: []prompb.Label{{Name: "__name__", Value: "netdata_cgroup_mem_usage_MiB_average"}, {Name: "instance", Value: server.Id}, {Name: "dimension", Value: "ram"}},
			Samples: []prompb.Sample{{Value: 128, Timestamp: 1776168000000}},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}

	tsdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer tsdb.Close()
	t.Setenv(monitormetrics.EnvVictoriaMetricsURL, tsdb.URL)

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
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader(string(payload)))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "application/x-protobuf")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(wrotePoints) != 1 {
		t.Fatalf("expected one valid canonical metric write, got %+v", wrotePoints)
	}
	if wrotePoints[0].Series != "appos_host_cpu_usage" || wrotePoints[0].Value != 17 {
		t.Fatalf("unexpected canonical metric %+v", wrotePoints[0])
	}
}

func TestMonitorWriteUsesContainerNameWhenContainerIDIsMissing(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, err := getOrIssueMonitorAgentToken(te.app, server.Id)
	if err != nil {
		t.Fatal(err)
	}

	payload, err := proto.Marshal(&prompb.WriteRequest{Timeseries: []prompb.TimeSeries{{
		Labels:  []prompb.Label{{Name: "__name__", Value: "netdata_cgroup_mem_usage_MiB_average"}, {Name: "instance", Value: server.Id}, {Name: "dimension", Value: "ram"}, {Name: "container_name", Value: "demo-web"}},
		Samples: []prompb.Sample{{Value: 128, Timestamp: 1776168000000}},
	}}})
	if err != nil {
		t.Fatal(err)
	}

	tsdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer tsdb.Close()
	t.Setenv(monitormetrics.EnvVictoriaMetricsURL, tsdb.URL)

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
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader(string(payload)))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "application/x-protobuf")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(wrotePoints) != 1 {
		t.Fatalf("expected one canonical container metric, got %+v", wrotePoints)
	}
	if wrotePoints[0].Series != "appos_container_memory_usage_bytes" {
		t.Fatalf("unexpected container series %+v", wrotePoints[0])
	}
	if wrotePoints[0].Labels["container_id"] != "demo-web" || wrotePoints[0].Labels["target_id"] != "demo-web" {
		t.Fatalf("expected fallback container identity demo-web, got %+v", wrotePoints[0].Labels)
	}
	if wrotePoints[0].Labels["container_name"] != "demo-web" {
		t.Fatalf("expected container_name label, got %+v", wrotePoints[0].Labels)
	}
}

func TestMonitorWriteUsesCgroupNameWhenContainerIdentityLabelsAreMissing(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, err := getOrIssueMonitorAgentToken(te.app, server.Id)
	if err != nil {
		t.Fatal(err)
	}

	payload, err := proto.Marshal(&prompb.WriteRequest{Timeseries: []prompb.TimeSeries{{
		Labels: []prompb.Label{
			{Name: "__name__", Value: "netdata_cgroup_mem_usage_MiB_average"},
			{Name: "instance", Value: server.Id},
			{Name: "dimension", Value: "ram"},
			{Name: "cgroup_name", Value: "appos"},
		},
		Samples: []prompb.Sample{{Value: 128, Timestamp: 1776168000000}},
	}}})
	if err != nil {
		t.Fatal(err)
	}

	tsdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer tsdb.Close()
	t.Setenv(monitormetrics.EnvVictoriaMetricsURL, tsdb.URL)

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
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader(string(payload)))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "application/x-protobuf")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(wrotePoints) != 1 {
		t.Fatalf("expected one canonical container metric, got %+v", wrotePoints)
	}
	if wrotePoints[0].Series != "appos_container_memory_usage_bytes" {
		t.Fatalf("unexpected container series %+v", wrotePoints[0])
	}
	if wrotePoints[0].Labels["container_id"] != "appos" || wrotePoints[0].Labels["target_id"] != "appos" {
		t.Fatalf("expected fallback container identity appos, got %+v", wrotePoints[0].Labels)
	}
	if wrotePoints[0].Labels["container_name"] != "appos" {
		t.Fatalf("expected container_name label from cgroup_name, got %+v", wrotePoints[0].Labels)
	}
}

func TestMonitorWriteUsesNetdataChartIdentityWhenContainerLabelsAreMissing(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, err := getOrIssueMonitorAgentToken(te.app, server.Id)
	if err != nil {
		t.Fatal(err)
	}

	payload, err := proto.Marshal(&prompb.WriteRequest{Timeseries: []prompb.TimeSeries{{
		Labels: []prompb.Label{
			{Name: "__name__", Value: "netdata_cgroup_cpu_limit_percentage_average"},
			{Name: "instance", Value: server.Id},
			{Name: "dimension", Value: "used"},
			{Name: "chart", Value: "cgroup_appos.cpu_limit"},
		},
		Samples: []prompb.Sample{{Value: 17.2, Timestamp: 1776168000000}},
	}}})
	if err != nil {
		t.Fatal(err)
	}

	tsdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer tsdb.Close()
	t.Setenv(monitormetrics.EnvVictoriaMetricsURL, tsdb.URL)

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
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader(string(payload)))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "application/x-protobuf")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(wrotePoints) != 1 {
		t.Fatalf("expected one canonical container metric, got %+v", wrotePoints)
	}
	if wrotePoints[0].Series != "appos_container_cpu_usage_percent" {
		t.Fatalf("unexpected container series %+v", wrotePoints[0])
	}
	if wrotePoints[0].Labels["container_id"] != "appos" || wrotePoints[0].Labels["target_id"] != "appos" {
		t.Fatalf("expected fallback container identity appos from chart label, got %+v", wrotePoints[0].Labels)
	}
	if wrotePoints[0].Labels["container_name"] != "appos" {
		t.Fatalf("expected container_name label from chart-derived identity, got %+v", wrotePoints[0].Labels)
	}
}

func TestMonitorWriteAlsoProjectsCanonicalContainerMemoryLimitMetricWhenUsedAndAvailableExist(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, err := getOrIssueMonitorAgentToken(te.app, server.Id)
	if err != nil {
		t.Fatal(err)
	}

	payload, err := proto.Marshal(&prompb.WriteRequest{Timeseries: []prompb.TimeSeries{
		{
			Labels:  []prompb.Label{{Name: "__name__", Value: "netdata_cgroup_mem_usage_limit_MiB_average"}, {Name: "instance", Value: server.Id}, {Name: "dimension", Value: "used"}, {Name: "container_id", Value: "ctr-1"}, {Name: "container_name", Value: "demo-web"}},
			Samples: []prompb.Sample{{Value: 128, Timestamp: 1776168000000}},
		},
		{
			Labels:  []prompb.Label{{Name: "__name__", Value: "netdata_cgroup_mem_usage_limit_MiB_average"}, {Name: "instance", Value: server.Id}, {Name: "dimension", Value: "available"}, {Name: "container_id", Value: "ctr-1"}, {Name: "container_name", Value: "demo-web"}},
			Samples: []prompb.Sample{{Value: 384, Timestamp: 1776168000000}},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}

	tsdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer tsdb.Close()
	t.Setenv(monitormetrics.EnvVictoriaMetricsURL, tsdb.URL)

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
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader(string(payload)))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "application/x-protobuf")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(wrotePoints) != 1 {
		t.Fatalf("expected one canonical metric point, got %+v", wrotePoints)
	}
	if wrotePoints[0].Series != "appos_container_memory_limit_bytes" {
		t.Fatalf("expected canonical container memory limit series, got %+v", wrotePoints[0])
	}
	if wrotePoints[0].Labels["container_id"] != "demo-web" || wrotePoints[0].Labels["target_id"] != "demo-web" {
		t.Fatalf("unexpected container labels: %+v", wrotePoints[0].Labels)
	}
	if wrotePoints[0].Value != 512*mibToBytes {
		t.Fatalf("unexpected memory limit value %+v", wrotePoints[0])
	}
}

func TestMonitorWriteSkipsCanonicalContainerMemoryLimitMetricWhenOnlyOneDimensionExists(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, err := getOrIssueMonitorAgentToken(te.app, server.Id)
	if err != nil {
		t.Fatal(err)
	}

	payload, err := proto.Marshal(&prompb.WriteRequest{Timeseries: []prompb.TimeSeries{{
		Labels:  []prompb.Label{{Name: "__name__", Value: "netdata_cgroup_mem_usage_limit_MiB_average"}, {Name: "instance", Value: server.Id}, {Name: "dimension", Value: "used"}, {Name: "container_id", Value: "ctr-1"}, {Name: "container_name", Value: "demo-web"}},
		Samples: []prompb.Sample{{Value: 128, Timestamp: 1776168000000}},
	}}})
	if err != nil {
		t.Fatal(err)
	}

	tsdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer tsdb.Close()
	t.Setenv(monitormetrics.EnvVictoriaMetricsURL, tsdb.URL)

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
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader(string(payload)))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "application/x-protobuf")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(wrotePoints) != 0 {
		t.Fatalf("expected no canonical container memory limit metric without both dimensions, got %+v", wrotePoints)
	}
}

func TestMonitorWriteAlsoProjectsCanonicalContainerNetworkMetricsWhenContainerIDExists(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, err := getOrIssueMonitorAgentToken(te.app, server.Id)
	if err != nil {
		t.Fatal(err)
	}

	payload, err := proto.Marshal(&prompb.WriteRequest{Timeseries: []prompb.TimeSeries{
		{
			Labels:  []prompb.Label{{Name: "__name__", Value: "netdata_cgroup_net_net_kilobits_persec_average"}, {Name: "instance", Value: server.Id}, {Name: "dimension", Value: "received"}, {Name: "container_id", Value: "ctr-1"}, {Name: "container_name", Value: "demo-web"}, {Name: "device", Value: "veth0"}},
			Samples: []prompb.Sample{{Value: 8, Timestamp: 1776168000000}},
		},
		{
			Labels:  []prompb.Label{{Name: "__name__", Value: "netdata_cgroup_net_net_kilobits_persec_average"}, {Name: "instance", Value: server.Id}, {Name: "dimension", Value: "received"}, {Name: "container_id", Value: "ctr-1"}, {Name: "container_name", Value: "demo-web"}, {Name: "device", Value: "veth1"}},
			Samples: []prompb.Sample{{Value: 4, Timestamp: 1776168000000}},
		},
		{
			Labels:  []prompb.Label{{Name: "__name__", Value: "netdata_cgroup_net_net_kilobits_persec_average"}, {Name: "instance", Value: server.Id}, {Name: "dimension", Value: "sent"}, {Name: "container_id", Value: "ctr-1"}, {Name: "container_name", Value: "demo-web"}, {Name: "device", Value: "veth0"}},
			Samples: []prompb.Sample{{Value: -2, Timestamp: 1776168000000}},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}

	tsdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer tsdb.Close()
	t.Setenv(monitormetrics.EnvVictoriaMetricsURL, tsdb.URL)

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
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader(string(payload)))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "application/x-protobuf")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(wrotePoints) != 2 {
		t.Fatalf("expected two canonical metric points, got %+v", wrotePoints)
	}
	sort.Slice(wrotePoints, func(i, j int) bool {
		return wrotePoints[i].Series < wrotePoints[j].Series
	})
	if wrotePoints[0].Series != "appos_container_network_receive_bytes_per_second" || wrotePoints[0].Value != 1500 {
		t.Fatalf("unexpected receive metric %+v", wrotePoints[0])
	}
	if wrotePoints[1].Series != "appos_container_network_transmit_bytes_per_second" || wrotePoints[1].Value != 250 {
		t.Fatalf("unexpected transmit metric %+v", wrotePoints[1])
	}
}

func TestMonitorWriteAlsoProjectsCanonicalContainerBlockRateMetricsWhenContainerIDExists(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newMonitorTestEnv(t)
	defer te.cleanup()

	server := createMonitorServer(t, te, "prod-01")
	token, err := getOrIssueMonitorAgentToken(te.app, server.Id)
	if err != nil {
		t.Fatal(err)
	}

	payload, err := proto.Marshal(&prompb.WriteRequest{Timeseries: []prompb.TimeSeries{
		{
			Labels:  []prompb.Label{{Name: "__name__", Value: "netdata_cgroup_io_KiB_persec_average"}, {Name: "instance", Value: server.Id}, {Name: "dimension", Value: "read"}, {Name: "container_id", Value: "ctr-1"}, {Name: "container_name", Value: "demo-web"}},
			Samples: []prompb.Sample{{Value: 4, Timestamp: 1776168000000}},
		},
		{
			Labels:  []prompb.Label{{Name: "__name__", Value: "netdata_cgroup_io_KiB_persec_average"}, {Name: "instance", Value: server.Id}, {Name: "dimension", Value: "write"}, {Name: "container_id", Value: "ctr-1"}, {Name: "container_name", Value: "demo-web"}},
			Samples: []prompb.Sample{{Value: -2, Timestamp: 1776168000000}},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}

	tsdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer tsdb.Close()
	t.Setenv(monitormetrics.EnvVictoriaMetricsURL, tsdb.URL)

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
	req := httptest.NewRequest(http.MethodPost, "/api/monitor/write", strings.NewReader(string(payload)))
	req.SetBasicAuth(server.Id, token)
	req.Header.Set("Content-Type", "application/x-protobuf")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(wrotePoints) != 2 {
		t.Fatalf("expected two canonical metric points, got %+v", wrotePoints)
	}
	sort.Slice(wrotePoints, func(i, j int) bool {
		return wrotePoints[i].Series < wrotePoints[j].Series
	})
	if wrotePoints[0].Series != "appos_container_block_read_bytes_per_second" || wrotePoints[0].Value != 4096 {
		t.Fatalf("unexpected read metric %+v", wrotePoints[0])
	}
	if wrotePoints[1].Series != "appos_container_block_write_bytes_per_second" || wrotePoints[1].Value != 2048 {
		t.Fatalf("unexpected write metric %+v", wrotePoints[1])
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
