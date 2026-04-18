package platform

import (
	"os"
	"runtime"
	"time"

	"github.com/websoft9/appos/backend/domain/monitor"
	monitormetrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
	monitstatus "github.com/websoft9/appos/backend/domain/monitor/status"
	"github.com/websoft9/appos/backend/platform/supervisor"
)

func (o *PlatformObserver) collectAppCoreTarget(now time.Time, snapshot RuntimeSnapshot, resource supervisor.ResourceInfo, mem runtime.MemStats) ([]monitormetrics.MetricPoint, error) {
	appCoreSummary := map[string]any{
		"pid":              os.Getpid(),
		"cpu_percent":      resource.CPU,
		"memory_bytes":     resource.Memory,
		"goroutines":       runtime.NumGoroutine(),
		"heap_alloc_bytes": mem.Alloc,
		"uptime_seconds":   secondsSince(now, snapshot.StartedAt),
		"go_version":       runtime.Version(),
		"num_cpu":          runtime.NumCPU(),
		"gc_cycles":        mem.NumGC,
		"last_gc_at":       formatUnixNano(mem.LastGC),
	}
	if err := monitstatus.ProjectPlatformLatestStatus(o.app, now, PlatformTargetAppOSCore, "AppOS Core", monitor.SignalSourceSelf, monitor.StatusHealthy, "", appCoreSummary); err != nil {
		return nil, err
	}
	points := []monitormetrics.MetricPoint{
		{Series: "appos_platform_goroutines", Value: float64(runtime.NumGoroutine()), Labels: platformMetricLabels(PlatformTargetAppOSCore), ObservedAt: now},
		{Series: "appos_platform_heap_alloc_bytes", Value: float64(mem.Alloc), Labels: platformMetricLabels(PlatformTargetAppOSCore), ObservedAt: now},
	}
	if uptime := secondsSinceFloat(now, snapshot.StartedAt); uptime > 0 {
		points = append(points, monitormetrics.MetricPoint{Series: "appos_platform_uptime_seconds", Value: uptime, Labels: platformMetricLabels(PlatformTargetAppOSCore), ObservedAt: now})
	}
	return points, nil
}

func (o *PlatformObserver) collectWorkerTarget(now time.Time, snapshot RuntimeSnapshot) ([]monitormetrics.MetricPoint, error) {
	workerStatus := monitor.StatusUnknown
	workerReason := "worker not started"
	if snapshot.WorkerRunning {
		workerStatus = monitor.StatusHealthy
		workerReason = ""
	} else if snapshot.StartedAt.IsZero() {
		workerStatus = monitor.StatusUnknown
	} else {
		workerStatus = monitor.StatusDegraded
		workerReason = firstNonEmpty(snapshot.LastServerError, "worker not running")
	}
	workerSummary := map[string]any{
		"server_running":       snapshot.ServerRunning,
		"scheduler_running":    snapshot.SchedulerRunning,
		"started_at":           formatTime(snapshot.StartedAt),
		"uptime_seconds":       secondsSince(now, snapshot.StartedAt),
		"last_server_error":    emptyToNil(snapshot.LastServerError),
		"last_dispatch_at":     formatTime(snapshot.LastDispatchAt),
		"dispatch_age_seconds": secondsSince(now, snapshot.LastDispatchAt),
		"last_dispatch_error":  emptyToNil(snapshot.LastDispatchError),
	}
	if err := monitstatus.ProjectPlatformLatestStatus(o.app, now, PlatformTargetWorker, "Worker", monitor.SignalSourceSelf, workerStatus, workerReason, workerSummary); err != nil {
		return nil, err
	}
	points := []monitormetrics.MetricPoint{
		{Series: "appos_worker_running", Value: boolMetric(snapshot.WorkerRunning), Labels: platformMetricLabels(PlatformTargetWorker), ObservedAt: now},
	}
	if uptime := secondsSinceFloat(now, snapshot.StartedAt); uptime > 0 {
		points = append(points, monitormetrics.MetricPoint{Series: "appos_worker_uptime_seconds", Value: uptime, Labels: platformMetricLabels(PlatformTargetWorker), ObservedAt: now})
	}
	if dispatchAge := secondsSinceFloat(now, snapshot.LastDispatchAt); dispatchAge > 0 {
		points = append(points, monitormetrics.MetricPoint{Series: "appos_worker_dispatch_age_seconds", Value: dispatchAge, Labels: platformMetricLabels(PlatformTargetWorker), ObservedAt: now})
	}
	return points, nil
}

func (o *PlatformObserver) collectSchedulerTarget(now time.Time, snapshot RuntimeSnapshot) ([]monitormetrics.MetricPoint, error) {
	schedulerStatus := monitor.StatusUnknown
	schedulerReason := "scheduler not started"
	if snapshot.SchedulerRunning {
		schedulerStatus = monitor.StatusHealthy
		schedulerReason = ""
		if !snapshot.SchedulerLastTick.IsZero() && now.Sub(snapshot.SchedulerLastTick) > PlatformSchedulerStaleThreshold {
			schedulerStatus = monitor.StatusDegraded
			schedulerReason = "scheduler tick stale"
		}
	} else if !snapshot.StartedAt.IsZero() {
		schedulerStatus = monitor.StatusDegraded
		schedulerReason = firstNonEmpty(snapshot.LastDispatchError, "scheduler not running")
	}
	schedulerSummary := map[string]any{
		"scheduler_running":    snapshot.SchedulerRunning,
		"last_tick_at":         formatTime(snapshot.SchedulerLastTick),
		"tick_age_seconds":     secondsSince(now, snapshot.SchedulerLastTick),
		"last_dispatch_at":     formatTime(snapshot.LastDispatchAt),
		"dispatch_age_seconds": secondsSince(now, snapshot.LastDispatchAt),
		"last_dispatch_error":  emptyToNil(snapshot.LastDispatchError),
	}
	if err := monitstatus.ProjectPlatformLatestStatus(o.app, now, PlatformTargetScheduler, "Scheduler", monitor.SignalSourceSelf, schedulerStatus, schedulerReason, schedulerSummary); err != nil {
		return nil, err
	}
	points := []monitormetrics.MetricPoint{
		{Series: "appos_scheduler_running", Value: boolMetric(snapshot.SchedulerRunning), Labels: platformMetricLabels(PlatformTargetScheduler), ObservedAt: now},
	}
	if tickAge := secondsSinceFloat(now, snapshot.SchedulerLastTick); tickAge > 0 {
		points = append(points, monitormetrics.MetricPoint{Series: "appos_scheduler_tick_age_seconds", Value: tickAge, Labels: platformMetricLabels(PlatformTargetScheduler), ObservedAt: now})
	}
	if dispatchAge := secondsSinceFloat(now, snapshot.LastDispatchAt); dispatchAge > 0 {
		points = append(points, monitormetrics.MetricPoint{Series: "appos_scheduler_dispatch_age_seconds", Value: dispatchAge, Labels: platformMetricLabels(PlatformTargetScheduler), ObservedAt: now})
	}
	return points, nil
}
