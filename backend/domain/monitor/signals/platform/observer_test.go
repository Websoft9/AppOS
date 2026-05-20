package platform_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/websoft9/appos/backend/domain/monitor"
	monitormetrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
	"github.com/websoft9/appos/backend/domain/monitor/signals/platform"
	"github.com/websoft9/appos/backend/infra/collections"
	"github.com/websoft9/appos/backend/infra/supervisor"
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
	observer.SetResourceFunc(func([]int) map[int]supervisor.ResourceInfo {
		return map[int]supervisor.ResourceInfo{}
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
	observer.SetResourceFunc(func([]int) map[int]supervisor.ResourceInfo {
		return map[int]supervisor.ResourceInfo{}
	})

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
	observer.SetResourceFunc(func([]int) map[int]supervisor.ResourceInfo {
		return map[int]supervisor.ResourceInfo{}
	})

	if err := observer.Collect(); err != nil {
		t.Fatal(err)
	}
	if len(captured) == 0 {
		t.Fatal("expected platform metrics to be written")
	}
	foundGoroutines := false
	foundCPU := false
	for _, point := range captured {
		if point.Series == "appos_platform_goroutines" {
			foundGoroutines = true
		}
		if point.Series == "appos_platform_cpu_percent" {
			foundCPU = true
		}
	}
	if !foundGoroutines {
		t.Fatalf("expected appos_platform_goroutines in %+v", captured)
	}
	if foundCPU {
		t.Fatalf("did not expect appos_platform_cpu_percent in %+v", captured)
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
	observer.SetResourceFunc(func([]int) map[int]supervisor.ResourceInfo { return map[int]supervisor.ResourceInfo{} })
	observer.SetContainerStatsFunc(func(context.Context) (string, error) {
		return `{"Container":"abc","Name":"demo-web","CPUPerc":"12.5%","MemUsage":"128MiB / 256MiB","NetIO":"1.0KiB / 2.0KiB","BlockIO":"3.0KiB / 4.0KiB"}`, nil
	})

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
	observer.SetResourceFunc(func([]int) map[int]supervisor.ResourceInfo { return map[int]supervisor.ResourceInfo{} })
	observer.SetContainerStatsFunc(func(context.Context) (string, error) {
		return "", errors.New("docker unavailable")
	})

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
	observer.SetResourceFunc(func([]int) map[int]supervisor.ResourceInfo { return map[int]supervisor.ResourceInfo{} })
	observer.SetContainerStatsFunc(func(context.Context) (string, error) { return "", nil })
	observer.SetNowFunc(func() time.Time { return now.Add(-30 * time.Second) })
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
	observer.SetResourceFunc(func([]int) map[int]supervisor.ResourceInfo { return map[int]supervisor.ResourceInfo{} })
	observer.SetContainerStatsFunc(func(context.Context) (string, error) { return "", nil })
	observer.SetHostTelemetryFunc(func(time.Time, platform.LocalHostTelemetryState) ([]monitormetrics.MetricPoint, platform.LocalHostTelemetryState, error) {
		return nil, platform.LocalHostTelemetryState{}, errors.New("host unavailable")
	})

	if err := observer.Collect(); err != nil {
		t.Fatal(err)
	}
}
