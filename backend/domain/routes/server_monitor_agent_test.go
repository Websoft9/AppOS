package routes

import (
	"strings"
	"testing"
)

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
