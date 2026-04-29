package routes

import (
	"net/http"
	"strings"
	"testing"
)

func TestMonitorAgentInstallRejectsInvalidAppOSBaseURL(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, http.MethodPost, "/api/servers/nonexistent/ops/monitor-agent/install", `{"apposBaseUrl":"console.example.com"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid apposBaseUrl to return 400, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseJSON(t, rec)
	if body["error"] != "invalid_appos_base_url" {
		t.Fatalf("expected invalid_appos_base_url error, got %#v", body["error"])
	}
}

func TestBuildNetdataExportingConfigHTTP(t *testing.T) {
	config, err := buildNetdataExportingConfig("srv-1", "http://console.example.com:9091/api/monitor/netdata/write")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(config, "[prometheus_remote_write:appos]") {
		t.Fatalf("expected http exporter section, got %q", config)
	}
	if !strings.Contains(config, "destination = console.example.com:9091") {
		t.Fatalf("expected explicit destination, got %q", config)
	}
	if !strings.Contains(config, "remote write URL path = /api/monitor/netdata/write") {
		t.Fatalf("expected remote write path, got %q", config)
	}
	if !strings.Contains(config, "hostname = srv-1") {
		t.Fatalf("expected hostname override, got %q", config)
	}
	if !strings.Contains(config, "send charts matching = system.cpu system.ram system.io system.net net.net disk_space.*") {
		t.Fatalf("expected server chart filter, got %q", config)
	}
}

func TestBuildNetdataExportingConfigHTTPSDefaultsPort(t *testing.T) {
	config, err := buildNetdataExportingConfig("srv-2", "https://appos.example.com/api/monitor/netdata/write")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(config, "[prometheus_remote_write:https:appos]") {
		t.Fatalf("expected https exporter section, got %q", config)
	}
	if !strings.Contains(config, "destination = appos.example.com:443") {
		t.Fatalf("expected default https port, got %q", config)
	}
}
