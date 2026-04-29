package main

import (
	"context"
	"testing"
	"time"
)

func TestCollectMetricsIncludesContainerTelemetry(t *testing.T) {
	originalStats := collectDockerContainerStatsFunc
	originalMeta := collectDockerContainerMetaFunc
	collectDockerContainerStatsFunc = func(context.Context) ([]dockerContainerStats, error) {
		return []dockerContainerStats{{
			ID:       "ctr-123",
			Name:     "demo-web",
			CPUPerc:  "12.5%",
			MemUsage: "128MiB / 1GiB",
			NetIO:    "2MiB / 3MiB",
		}}, nil
	}
	collectDockerContainerMetaFunc = func(context.Context) ([]dockerContainerMetadata, error) {
		return []dockerContainerMetadata{{
			ID:             "ctr-123",
			Name:           "demo-web",
			ComposeProject: "demo",
			ComposeService: "web",
		}}, nil
	}
	defer func() {
		collectDockerContainerStatsFunc = originalStats
		collectDockerContainerMetaFunc = originalMeta
	}()

	agent := &agent{
		config:     config{ServerID: "srv-1"},
		hostname:   "host-1",
		cpuSampler: &cpuSampler{previous: &cpuSample{total: 1, idle: 0}},
		containerNetworkSamples: map[string]containerNetworkSample{
			"ctr-123": {
				rxBytes:    1024 * 1024,
				txBytes:    2 * 1024 * 1024,
				observedAt: time.Date(2026, 4, 14, 11, 59, 0, 0, time.UTC),
			},
		},
	}
	observedAt := time.Date(2026, 4, 14, 12, 0, 0, 0, time.UTC)

	items, err := agent.collectMetrics(context.Background(), observedAt)
	if err != nil {
		t.Fatal(err)
	}

	assertMetricItem(t, items, metricsPayloadItem{
		TargetType: containerTargetType,
		TargetID:   "ctr-123",
		Series:     containerCPUMetric,
		Unit:       "percent",
		ObservedAt: observedAt.Format(time.RFC3339),
	}, func(item metricsPayloadItem) bool {
		return item.Value == 12.5 && item.Labels["container_name"] == "demo-web" && item.Labels["compose_project"] == "demo" && item.Labels["compose_service"] == "web"
	})
	assertMetricItem(t, items, metricsPayloadItem{
		TargetType: containerTargetType,
		TargetID:   "ctr-123",
		Series:     containerMemoryMetric,
		Unit:       "bytes",
		ObservedAt: observedAt.Format(time.RFC3339),
	}, func(item metricsPayloadItem) bool {
		return item.Value == float64(128*1024*1024)
	})
	assertMetricItem(t, items, metricsPayloadItem{
		TargetType: containerTargetType,
		TargetID:   "ctr-123",
		Series:     containerNetworkRXMetric,
		Unit:       "bytes/s",
		ObservedAt: observedAt.Format(time.RFC3339),
	}, func(item metricsPayloadItem) bool {
		return item.Value == float64(1024*1024)/60
	})
	assertMetricItem(t, items, metricsPayloadItem{
		TargetType: containerTargetType,
		TargetID:   "ctr-123",
		Series:     containerNetworkTXMetric,
		Unit:       "bytes/s",
		ObservedAt: observedAt.Format(time.RFC3339),
	}, func(item metricsPayloadItem) bool {
		return item.Value == float64(1024*1024)/60
	})

	baseline := agent.containerNetworkSamples["ctr-123"]
	if baseline.rxBytes != 2*1024*1024 || baseline.txBytes != 3*1024*1024 {
		t.Fatalf("expected refreshed network baseline, got %+v", baseline)
	}
}

func TestCollectMetricsSkipsInitialContainerNetworkRate(t *testing.T) {
	originalStats := collectDockerContainerStatsFunc
	originalMeta := collectDockerContainerMetaFunc
	collectDockerContainerStatsFunc = func(context.Context) ([]dockerContainerStats, error) {
		return []dockerContainerStats{{
			ID:       "ctr-456",
			Name:     "demo-worker",
			CPUPerc:  "3.1%",
			MemUsage: "64MiB / 1GiB",
			NetIO:    "512KiB / 256KiB",
		}}, nil
	}
	collectDockerContainerMetaFunc = func(context.Context) ([]dockerContainerMetadata, error) {
		return nil, nil
	}
	defer func() {
		collectDockerContainerStatsFunc = originalStats
		collectDockerContainerMetaFunc = originalMeta
	}()

	agent := &agent{
		config:                  config{ServerID: "srv-1"},
		hostname:                "host-1",
		cpuSampler:              &cpuSampler{previous: &cpuSample{total: 1, idle: 0}},
		containerNetworkSamples: map[string]containerNetworkSample{},
	}

	items, err := agent.collectMetrics(context.Background(), time.Date(2026, 4, 14, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.Series == containerNetworkRXMetric || item.Series == containerNetworkTXMetric {
			t.Fatalf("expected no network rate on first observation, got %+v", item)
		}
	}
	if _, ok := agent.containerNetworkSamples["ctr-456"]; !ok {
		t.Fatal("expected first observation to seed network baseline")
	}
}

func assertMetricItem(t *testing.T, items []metricsPayloadItem, expected metricsPayloadItem, match func(metricsPayloadItem) bool) {
	t.Helper()
	for _, item := range items {
		if item.TargetType != expected.TargetType || item.TargetID != expected.TargetID || item.Series != expected.Series || item.Unit != expected.Unit || item.ObservedAt != expected.ObservedAt {
			continue
		}
		if match == nil || match(item) {
			return
		}
	}
	t.Fatalf("expected metric item %+v, got %+v", expected, items)
}
