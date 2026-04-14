package monitor

import (
	"context"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/platform/supervisor"
)

const (
	PlatformTargetAppOSCore = "appos-core"
	PlatformTargetWorker    = "worker"
	PlatformTargetScheduler = "scheduler"

	PlatformObserverInterval        = 30 * time.Second
	PlatformSchedulerStaleThreshold = 10 * time.Second
)

type RuntimeSnapshot struct {
	StartedAt         time.Time
	ServerRunning     bool
	WorkerRunning     bool
	SchedulerRunning  bool
	SchedulerLastTick time.Time
	LastDispatchAt    time.Time
	LastServerError   string
	LastDispatchError string
}

type PlatformObserver struct {
	app        core.App
	snapshotFn func() RuntimeSnapshot
	nowFn      func() time.Time
	mu         sync.Mutex
	cancel     context.CancelFunc
}

func NewPlatformObserver(app core.App, snapshotFn func() RuntimeSnapshot) *PlatformObserver {
	return &PlatformObserver{
		app:        app,
		snapshotFn: snapshotFn,
		nowFn: func() time.Time {
			return time.Now().UTC()
		},
	}
}

func (o *PlatformObserver) SetNowFunc(nowFn func() time.Time) {
	if nowFn == nil {
		return
	}
	o.nowFn = nowFn
}

func (o *PlatformObserver) Start() {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.cancel != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	o.cancel = cancel
	go o.run(ctx)
}

func (o *PlatformObserver) Stop() {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.cancel != nil {
		o.cancel()
		o.cancel = nil
	}
}

func (o *PlatformObserver) Collect() error {
	now := o.nowFn()
	snapshot := RuntimeSnapshot{}
	if o.snapshotFn != nil {
		snapshot = o.snapshotFn()
	}
	resources := supervisor.GetProcessResources([]int{os.Getpid()})
	resource := resources[os.Getpid()]
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

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
	if err := o.writePlatformStatus(now, PlatformTargetAppOSCore, "AppOS Core", StatusHealthy, "", appCoreSummary); err != nil {
		return err
	}
	platformMetricPoints := []MetricPoint{
		{Series: "appos_platform_cpu_percent", Value: resource.CPU, Labels: platformMetricLabels(PlatformTargetAppOSCore), ObservedAt: now},
		{Series: "appos_platform_memory_bytes", Value: float64(resource.Memory), Labels: platformMetricLabels(PlatformTargetAppOSCore), ObservedAt: now},
		{Series: "appos_platform_goroutines", Value: float64(runtime.NumGoroutine()), Labels: platformMetricLabels(PlatformTargetAppOSCore), ObservedAt: now},
		{Series: "appos_platform_heap_alloc_bytes", Value: float64(mem.Alloc), Labels: platformMetricLabels(PlatformTargetAppOSCore), ObservedAt: now},
	}
	if uptime := secondsSinceFloat(now, snapshot.StartedAt); uptime > 0 {
		platformMetricPoints = append(platformMetricPoints, MetricPoint{Series: "appos_platform_uptime_seconds", Value: uptime, Labels: platformMetricLabels(PlatformTargetAppOSCore), ObservedAt: now})
	}

	workerStatus := StatusUnknown
	workerReason := "worker not started"
	if snapshot.WorkerRunning {
		workerStatus = StatusHealthy
		workerReason = ""
	} else if snapshot.StartedAt.IsZero() {
		workerStatus = StatusUnknown
	} else {
		workerStatus = StatusDegraded
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
	if err := o.writePlatformStatus(now, PlatformTargetWorker, "Worker", workerStatus, workerReason, workerSummary); err != nil {
		return err
	}
	platformMetricPoints = append(platformMetricPoints,
		MetricPoint{Series: "appos_worker_running", Value: boolMetric(snapshot.WorkerRunning), Labels: platformMetricLabels(PlatformTargetWorker), ObservedAt: now},
	)
	if uptime := secondsSinceFloat(now, snapshot.StartedAt); uptime > 0 {
		platformMetricPoints = append(platformMetricPoints, MetricPoint{Series: "appos_worker_uptime_seconds", Value: uptime, Labels: platformMetricLabels(PlatformTargetWorker), ObservedAt: now})
	}
	if dispatchAge := secondsSinceFloat(now, snapshot.LastDispatchAt); dispatchAge > 0 {
		platformMetricPoints = append(platformMetricPoints, MetricPoint{Series: "appos_worker_dispatch_age_seconds", Value: dispatchAge, Labels: platformMetricLabels(PlatformTargetWorker), ObservedAt: now})
	}

	schedulerStatus := StatusUnknown
	schedulerReason := "scheduler not started"
	if snapshot.SchedulerRunning {
		schedulerStatus = StatusHealthy
		schedulerReason = ""
		if !snapshot.SchedulerLastTick.IsZero() && now.Sub(snapshot.SchedulerLastTick) > PlatformSchedulerStaleThreshold {
			schedulerStatus = StatusDegraded
			schedulerReason = "scheduler tick stale"
		}
	} else if !snapshot.StartedAt.IsZero() {
		schedulerStatus = StatusDegraded
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
	if err := o.writePlatformStatus(now, PlatformTargetScheduler, "Scheduler", schedulerStatus, schedulerReason, schedulerSummary); err != nil {
		return err
	}
	platformMetricPoints = append(platformMetricPoints,
		MetricPoint{Series: "appos_scheduler_running", Value: boolMetric(snapshot.SchedulerRunning), Labels: platformMetricLabels(PlatformTargetScheduler), ObservedAt: now},
	)
	if tickAge := secondsSinceFloat(now, snapshot.SchedulerLastTick); tickAge > 0 {
		platformMetricPoints = append(platformMetricPoints, MetricPoint{Series: "appos_scheduler_tick_age_seconds", Value: tickAge, Labels: platformMetricLabels(PlatformTargetScheduler), ObservedAt: now})
	}
	if dispatchAge := secondsSinceFloat(now, snapshot.LastDispatchAt); dispatchAge > 0 {
		platformMetricPoints = append(platformMetricPoints, MetricPoint{Series: "appos_scheduler_dispatch_age_seconds", Value: dispatchAge, Labels: platformMetricLabels(PlatformTargetScheduler), ObservedAt: now})
	}

	if err := WriteMetricPoints(context.Background(), platformMetricPoints); err != nil {
		return err
	}

	return nil
}

func (o *PlatformObserver) run(ctx context.Context) {
	_ = o.Collect()
	ticker := time.NewTicker(PlatformObserverInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = o.Collect()
		}
	}
}

func (o *PlatformObserver) writePlatformStatus(now time.Time, targetID, displayName, status, reason string, summary map[string]any) error {
	lastSuccessAt := (*time.Time)(nil)
	lastFailureAt := (*time.Time)(nil)
	failures := 0
	if status == StatusHealthy {
		lastSuccessAt = &now
	} else {
		lastFailureAt = &now
		failures = 1
	}
	_, err := UpsertLatestStatus(o.app, LatestStatusUpsert{
		TargetType:              TargetTypePlatform,
		TargetID:                targetID,
		DisplayName:             displayName,
		Status:                  status,
		Reason:                  reason,
		SignalSource:            SignalSourceSelf,
		LastTransitionAt:        now,
		LastSuccessAt:           lastSuccessAt,
		LastFailureAt:           lastFailureAt,
		LastReportedAt:          &now,
		ConsecutiveFailures:     &failures,
		Summary:                 summary,
		PreserveStrongerFailure: false,
	})
	return err
}

func formatTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value.UTC().Format(time.RFC3339)
}

func formatUnixNano(value uint64) any {
	if value == 0 {
		return nil
	}
	return time.Unix(0, int64(value)).UTC().Format(time.RFC3339)
}

func secondsSince(now, value time.Time) any {
	if value.IsZero() {
		return nil
	}
	seconds := secondsSinceFloat(now, value)
	return seconds
}

func secondsSinceFloat(now, value time.Time) float64 {
	if value.IsZero() {
		return 0
	}
	seconds := now.Sub(value).Seconds()
	if seconds < 0 {
		seconds = 0
	}
	return seconds
}

func boolMetric(value bool) float64 {
	if value {
		return 1
	}
	return 0
}

func platformMetricLabels(targetID string) map[string]string {
	return map[string]string{
		"target_type": TargetTypePlatform,
		"target_id":   targetID,
	}
}

func emptyToNil(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
