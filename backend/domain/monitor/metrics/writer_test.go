package metrics_test

import (
	"context"
	metrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWriteMetricPointsWritesVictoriaMetricsPrometheusImport(t *testing.T) {
	var gotPath string
	var gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	t.Setenv(metrics.EnvVictoriaMetricsURL, server.URL)
	if err := metrics.WriteMetricPoints(context.Background(), []metrics.MetricPoint{{
		Series:     "appos_host_cpu_usage",
		Value:      0.42,
		Labels:     map[string]string{"server_id": "srv_1", "target_type": "server", "target_id": "srv_1"},
		ObservedAt: time.Date(2026, 4, 14, 12, 0, 0, 0, time.UTC),
	}}); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/api/v1/import/prometheus" {
		t.Fatalf("expected VM import path, got %q", gotPath)
	}
	if !strings.Contains(gotBody, `appos_host_cpu_usage{server_id="srv_1",target_id="srv_1",target_type="server"} 0.42 1776168000000`) {
		t.Fatalf("unexpected VM payload: %s", gotBody)
	}
}

func TestWriteMetricPointsRejectsUnknownSeries(t *testing.T) {
	err := metrics.WriteMetricPoints(context.Background(), []metrics.MetricPoint{{
		Series:     "appos_not_allowed",
		Value:      1,
		ObservedAt: time.Now().UTC(),
	}})
	if err == nil || !strings.Contains(err.Error(), "not allowed") {
		t.Fatalf("expected allowlist rejection, got %v", err)
	}
}
