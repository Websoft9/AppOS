package platform_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitormetrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
	"github.com/websoft9/appos/backend/domain/monitor/signals/platform"
	monitorstore "github.com/websoft9/appos/backend/domain/monitor/status/store"
	"github.com/websoft9/appos/backend/infra/collections"
	"github.com/websoft9/appos/backend/infra/process"
)

func TestPlatformObserverCollectWritesPlatformTargets(t *testing.T) {
	app := newPlatformTestApp(t)
	defer app.Cleanup()

	now := time.Date(2026, 4, 14, 12, 0, 0, 0, time.UTC)
	observer := platform.NewPlatformObserver(app, func() platform.RuntimeSnapshot {
		return platform.RuntimeSnapshot{
			StartedAt:         now.Add(-time.Minute),
			WorkerRunning:     true,
			SchedulerRunning:  true,
			SchedulerLastTick: now,
			LastDispatchAt:    now,
		}
	})
	observer.SetNowFunc(func() time.Time { return now })
	observer.SetResourceFunc(func([]int) map[int]process.ResourceInfo {
		return map[int]process.ResourceInfo{
			os.Getpid(): {CPU: 12.5, Memory: 2048},
		}
	})

	if err := observer.Collect(); err != nil {
		t.Fatal(err)
	}

	for _, targetID := range []string{platform.PlatformTargetAppOSCore, platform.PlatformTargetWorker, platform.PlatformTargetScheduler} {
		record, findErr := app.FindFirstRecordByFilter(
			collections.MonitorLatestStatus,
			"target_type = {:targetType} && target_id = {:targetID}",
			map[string]any{"targetType": monitor.TargetTypePlatform, "targetID": targetID},
		)
		if findErr != nil {
			t.Fatalf("expected platform target %s: %v", targetID, findErr)
		}
		if record.GetString("status") == "" {
			t.Fatalf("expected status for %s", targetID)
		}
	}
}

func TestPlatformObserverCollectMarksStaleSchedulerDegraded(t *testing.T) {
	app := newPlatformTestApp(t)
	defer app.Cleanup()

	now := time.Date(2026, 4, 14, 12, 0, 0, 0, time.UTC)
	observer := platform.NewPlatformObserver(app, func() platform.RuntimeSnapshot {
		return platform.RuntimeSnapshot{
			StartedAt:         now.Add(-time.Minute),
			WorkerRunning:     true,
			SchedulerRunning:  true,
			SchedulerLastTick: now.Add(-platform.PlatformSchedulerStaleThreshold).Add(-time.Second),
			LastDispatchAt:    now.Add(-platform.PlatformSchedulerStaleThreshold).Add(-time.Second),
		}
	})
	observer.SetNowFunc(func() time.Time { return now })
	observer.SetResourceFunc(func([]int) map[int]process.ResourceInfo {
		return map[int]process.ResourceInfo{}
	})
	if err := sysconfig.SetGroup(app, "monitor", "platform-self-observation", map[string]any{
		"platformObserverIntervalSeconds":        30,
		"platformSchedulerStaleThresholdSeconds": 10,
		"enableHostTelemetry":                    false,
		"enableContainerTelemetry":               false,
	}); err != nil {
		t.Fatal(err)
	}

	if err := observer.Collect(); err != nil {
		t.Fatal(err)
	}

	record, err := app.FindFirstRecordByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": monitor.TargetTypePlatform, "targetID": platform.PlatformTargetScheduler},
	)
	if err != nil {
		t.Fatal(err)
	}
	if got := record.GetString("status"); got != monitor.StatusDegraded {
		t.Fatalf("expected degraded scheduler status, got %q", got)
	}
}

func TestPlatformObserverCollectWritesPlatformMetrics(t *testing.T) {
	app := newPlatformTestApp(t)
	defer app.Cleanup()

	now := time.Date(2026, 4, 14, 12, 0, 0, 0, time.UTC)
	var captured []monitormetrics.MetricPoint
	restore := monitormetrics.SetMetricWriteFuncForTest(func(_ context.Context, points []monitormetrics.MetricPoint) error {
		captured = append(captured, points...)
		return nil
	})
	defer restore()

	observer := platform.NewPlatformObserver(app, func() platform.RuntimeSnapshot {
		return platform.RuntimeSnapshot{
			StartedAt:         now.Add(-time.Minute),
			ServerRunning:     true,
			WorkerRunning:     true,
			SchedulerRunning:  true,
			SchedulerLastTick: now,
			LastDispatchAt:    now,
		}
	})
	observer.SetNowFunc(func() time.Time { return now })
	observer.SetResourceFunc(func([]int) map[int]process.ResourceInfo {
		return map[int]process.ResourceInfo{}
	})

	if err := observer.Collect(); err != nil {
		t.Fatal(err)
	}
	if len(captured) == 0 {
		t.Fatal("expected platform metrics to be written")
	}

	foundGoroutines := false
	foundCPU := false
	foundMemory := false
	for _, point := range captured {
		if point.Series == "appos_platform_goroutines" {
			foundGoroutines = true
		}
		if point.Series == "appos_platform_cpu_percent" {
			foundCPU = true
		}
		if point.Series == "appos_platform_memory_bytes" {
			foundMemory = true
		}
		if strings.HasPrefix(point.Series, "appos_host_") || strings.HasPrefix(point.Series, "appos_container_") {
			t.Fatalf("expected restricted default to skip host/container telemetry, got %+v", captured)
		}
	}
	if !foundGoroutines {
		t.Fatalf("expected appos_platform_goroutines in %+v", captured)
	}
	if !foundCPU {
		t.Fatalf("expected appos_platform_cpu_percent in %+v", captured)
	}
	if !foundMemory {
		t.Fatalf("expected appos_platform_memory_bytes in %+v", captured)
	}
}

func TestPlatformObserverCollectOmitsAvailableMemoryWhenLimitUnknown(t *testing.T) {
	app := newPlatformTestApp(t)
	defer app.Cleanup()

	now := time.Date(2026, 4, 14, 12, 0, 0, 0, time.UTC)
	var captured []monitormetrics.MetricPoint
	restore := monitormetrics.SetMetricWriteFuncForTest(func(_ context.Context, points []monitormetrics.MetricPoint) error {
		captured = append(captured, points...)
		return nil
	})
	defer restore()

	observer := platform.NewPlatformObserver(app, func() platform.RuntimeSnapshot {
		return platform.RuntimeSnapshot{StartedAt: now.Add(-time.Minute), WorkerRunning: true, SchedulerRunning: true, SchedulerLastTick: now, LastDispatchAt: now}
	})
	observer.SetNowFunc(func() time.Time { return now })
	observer.SetResourceFunc(func([]int) map[int]process.ResourceInfo {
		return map[int]process.ResourceInfo{os.Getpid(): {CPU: 1.5, Memory: 2048}}
	})
	observer.SetAppCoreMemoryFunc(func() (float64, float64, bool, error) {
		return 4096, 0, false, nil
	})

	if err := observer.Collect(); err != nil {
		t.Fatal(err)
	}

	for _, point := range captured {
		if point.Series == "appos_platform_memory_available_bytes" {
			t.Fatalf("expected memory available metric to be omitted when limit is unknown, got %+v", captured)
		}
	}

	record, err := app.FindFirstRecordByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": monitor.TargetTypePlatform, "targetID": platform.PlatformTargetAppOSCore},
	)
	if err != nil {
		t.Fatal(err)
	}
	summaryMap, err := monitorstore.SummaryFromRecord(record)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := summaryMap["memory_available_bytes"]; exists {
		t.Fatalf("expected summary to omit memory_available_bytes when limit is unknown, got %#v", summaryMap)
	}
}

func TestPlatformObserverCollectDegradesAppCoreWhenSelfTelemetryFails(t *testing.T) {
	app := newPlatformTestApp(t)
	defer app.Cleanup()

	now := time.Date(2026, 4, 14, 12, 0, 0, 0, time.UTC)
	observer := platform.NewPlatformObserver(app, func() platform.RuntimeSnapshot {
		return platform.RuntimeSnapshot{StartedAt: now.Add(-time.Minute), WorkerRunning: true, SchedulerRunning: true, SchedulerLastTick: now, LastDispatchAt: now}
	})
	observer.SetNowFunc(func() time.Time { return now })
	observer.SetResourceFunc(func([]int) map[int]process.ResourceInfo { return map[int]process.ResourceInfo{} })
	observer.SetAppCoreTelemetryFunc(func(time.Time, platform.LocalAppCoreTelemetryState) ([]monitormetrics.MetricPoint, platform.LocalAppCoreTelemetryState, error) {
		return nil, platform.LocalAppCoreTelemetryState{}, errors.New("cgroup unavailable")
	})

	if err := observer.Collect(); err != nil {
		t.Fatal(err)
	}

	record, err := app.FindFirstRecordByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": monitor.TargetTypePlatform, "targetID": platform.PlatformTargetAppOSCore},
	)
	if err != nil {
		t.Fatal(err)
	}
	if got := record.GetString("status"); got != monitor.StatusDegraded {
		t.Fatalf("expected degraded appos-core status, got %q", got)
	}
	if got := record.GetString("reason"); got != "local app-core telemetry failed" {
		t.Fatalf("unexpected degraded reason: %q", got)
	}
}

func TestPlatformObserverCollectWritesLocalContainerMetrics(t *testing.T) {
	app := newPlatformTestApp(t)
	defer app.Cleanup()

	now := time.Date(2026, 4, 14, 12, 0, 30, 0, time.UTC)
	var captured []monitormetrics.MetricPoint
	restore := monitormetrics.SetMetricWriteFuncForTest(func(_ context.Context, points []monitormetrics.MetricPoint) error {
		captured = append(captured, points...)
		return nil
	})
	defer restore()

	observer := platform.NewPlatformObserver(app, func() platform.RuntimeSnapshot {
		return platform.RuntimeSnapshot{}
	})
	observer.SetNowFunc(func() time.Time { return now.Add(-30 * time.Second) })
	observer.SetResourceFunc(func([]int) map[int]process.ResourceInfo { return map[int]process.ResourceInfo{} })
	observer.SetContainerStatsFunc(func(context.Context) (string, error) {
		return `{"Container":"abc","Name":"demo-web","CPUPerc":"12.5%","MemUsage":"128MiB / 256MiB","NetIO":"1.0KiB / 2.0KiB","BlockIO":"3.0KiB / 4.0KiB"}`, nil
	})
	if err := sysconfig.SetGroup(app, "monitor", "platform-self-observation", map[string]any{
		"platformObserverIntervalSeconds":        30,
		"platformSchedulerStaleThresholdSeconds": 10,
		"enableHostTelemetry":                    false,
		"enableContainerTelemetry":               true,
	}); err != nil {
		t.Fatal(err)
	}

	if err := observer.Collect(); err != nil {
		t.Fatal(err)
	}

	observer.SetNowFunc(func() time.Time { return now })
	observer.SetContainerStatsFunc(func(context.Context) (string, error) {
		return `{"Container":"abc","Name":"demo-web","CPUPerc":"25.0%","MemUsage":"160MiB / 256MiB","NetIO":"3.0KiB / 5.0KiB","BlockIO":"9.0KiB / 10.0KiB"}`, nil
	})

	if err := observer.Collect(); err != nil {
		t.Fatal(err)
	}

	seen := map[string]monitormetrics.MetricPoint{}
	for _, point := range captured {
		if point.Labels["container_id"] == "demo-web" {
			seen[point.Series] = point
		}
	}
	for _, series := range []string{
		"appos_container_cpu_usage_percent",
		"appos_container_memory_usage_bytes",
		"appos_container_memory_limit_bytes",
		"appos_container_network_receive_bytes_per_second",
		"appos_container_network_transmit_bytes_per_second",
		"appos_container_block_read_bytes_per_second",
		"appos_container_block_write_bytes_per_second",
	} {
		if _, ok := seen[series]; !ok {
			t.Fatalf("expected %s in %+v", series, captured)
		}
	}
	if got := seen["appos_container_network_receive_bytes_per_second"].Labels["server_id"]; got != "local" {
		t.Fatalf("expected local server_id, got %q", got)
	}
	if got := seen["appos_container_network_receive_bytes_per_second"].Value; got <= 0 {
		t.Fatalf("expected positive network receive rate, got %v", got)
	}
}

func TestPlatformObserverCollectSkipsLocalContainerTelemetryErrors(t *testing.T) {
	app := newPlatformTestApp(t)
	defer app.Cleanup()

	now := time.Date(2026, 4, 14, 12, 0, 0, 0, time.UTC)
	observer := platform.NewPlatformObserver(app, func() platform.RuntimeSnapshot {
		return platform.RuntimeSnapshot{
			StartedAt:         now.Add(-time.Minute),
			WorkerRunning:     true,
			SchedulerRunning:  true,
			SchedulerLastTick: now,
			LastDispatchAt:    now,
		}
	})
	observer.SetNowFunc(func() time.Time { return now })
	observer.SetResourceFunc(func([]int) map[int]process.ResourceInfo { return map[int]process.ResourceInfo{} })
	observer.SetContainerStatsFunc(func(context.Context) (string, error) {
		return "", errors.New("docker unavailable")
	})
	if err := sysconfig.SetGroup(app, "monitor", "platform-self-observation", map[string]any{
		"platformObserverIntervalSeconds":        30,
		"platformSchedulerStaleThresholdSeconds": 10,
		"enableHostTelemetry":                    false,
		"enableContainerTelemetry":               true,
	}); err != nil {
		t.Fatal(err)
	}

	if err := observer.Collect(); err != nil {
		t.Fatal(err)
	}
}

func TestPlatformObserverCollectWritesLocalHostMetrics(t *testing.T) {
	app := newPlatformTestApp(t)
	defer app.Cleanup()

	now := time.Date(2026, 4, 14, 12, 0, 30, 0, time.UTC)
	var captured []monitormetrics.MetricPoint
	restore := monitormetrics.SetMetricWriteFuncForTest(func(_ context.Context, points []monitormetrics.MetricPoint) error {
		captured = append(captured, points...)
		return nil
	})
	defer restore()

	observer := platform.NewPlatformObserver(app, func() platform.RuntimeSnapshot { return platform.RuntimeSnapshot{} })
	observer.SetResourceFunc(func([]int) map[int]process.ResourceInfo { return map[int]process.ResourceInfo{} })
	observer.SetContainerStatsFunc(func(context.Context) (string, error) { return "", nil })
	observer.SetNowFunc(func() time.Time { return now.Add(-30 * time.Second) })
	if err := sysconfig.SetGroup(app, "monitor", "platform-self-observation", map[string]any{
		"platformObserverIntervalSeconds":        30,
		"platformSchedulerStaleThresholdSeconds": 10,
		"enableHostTelemetry":                    true,
		"enableContainerTelemetry":               false,
	}); err != nil {
		t.Fatal(err)
	}
	observer.SetHostTelemetryFunc(func(observedAt time.Time, _ platform.LocalHostTelemetryState) ([]monitormetrics.MetricPoint, platform.LocalHostTelemetryState, error) {
		return []monitormetrics.MetricPoint{
			{Series: "appos_host_memory_bytes", Value: 100, Labels: map[string]string{"server_id": "appos-core", "target_type": "server", "target_id": "appos-core"}, ObservedAt: observedAt},
		}, platform.LocalHostTelemetryState{ObservedAt: observedAt}, nil
	})

	if err := observer.Collect(); err != nil {
		t.Fatal(err)
	}

	found := false
	for _, point := range captured {
		if point.Series == "appos_host_memory_bytes" && point.Labels["target_id"] == "appos-core" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected appos_host_memory_bytes in %+v", captured)
	}
}

func TestPlatformObserverCollectSkipsLocalHostTelemetryErrors(t *testing.T) {
	app := newPlatformTestApp(t)
	defer app.Cleanup()

	now := time.Date(2026, 4, 14, 12, 0, 0, 0, time.UTC)
	observer := platform.NewPlatformObserver(app, func() platform.RuntimeSnapshot {
		return platform.RuntimeSnapshot{StartedAt: now.Add(-time.Minute), WorkerRunning: true, SchedulerRunning: true, SchedulerLastTick: now, LastDispatchAt: now}
	})
	observer.SetNowFunc(func() time.Time { return now })
	observer.SetResourceFunc(func([]int) map[int]process.ResourceInfo { return map[int]process.ResourceInfo{} })
	observer.SetContainerStatsFunc(func(context.Context) (string, error) { return "", nil })
	if err := sysconfig.SetGroup(app, "monitor", "platform-self-observation", map[string]any{
		"platformObserverIntervalSeconds":        30,
		"platformSchedulerStaleThresholdSeconds": 10,
		"enableHostTelemetry":                    true,
		"enableContainerTelemetry":               false,
	}); err != nil {
		t.Fatal(err)
	}
	observer.SetHostTelemetryFunc(func(time.Time, platform.LocalHostTelemetryState) ([]monitormetrics.MetricPoint, platform.LocalHostTelemetryState, error) {
		return nil, platform.LocalHostTelemetryState{}, errors.New("host unavailable")
	})

	if err := observer.Collect(); err != nil {
		t.Fatal(err)
	}
}
