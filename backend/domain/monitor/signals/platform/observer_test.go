package platform_test

import (
	"context"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitormetrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
	"github.com/websoft9/appos/backend/domain/monitor/signals/platform"
	"github.com/websoft9/appos/backend/infra/collections"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func TestPlatformObserverCollectWritesPlatformTargets(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
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
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
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
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
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
