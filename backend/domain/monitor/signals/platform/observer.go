package platform

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"runtime"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitormetrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
	monitorstatus "github.com/websoft9/appos/backend/domain/monitor/status"
	"github.com/websoft9/appos/backend/infra/process"
)

func localContainerStatsDisabled(context.Context) (string, error) {
	return "", fmt.Errorf("local docker daemon access disabled")
}

func NewPlatformObserver(app core.App, snapshotFn func() RuntimeSnapshot) *PlatformObserver {
	return &PlatformObserver{
		app:                app,
		snapshotFn:         snapshotFn,
		resourceFn:         process.GetProcessResources,
		appCoreTelemetryFn: collectLocalAppCoreMetricPoints,
		appCoreMemoryFn:    readLocalAppCoreMemory,
		hostTelemetryFn:    collectLocalHostMetricPoints,
		containerStatsFn:   localContainerStatsDisabled,
		containerSamples:   map[string]localContainerCounters{},
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

func (o *PlatformObserver) SetResourceFunc(resourceFn func([]int) map[int]process.ResourceInfo) {
	if resourceFn == nil {
		return
	}
	o.resourceFn = resourceFn
}

func (o *PlatformObserver) SetAppCoreTelemetryFunc(appCoreTelemetryFn func(time.Time, localAppCoreTelemetryState) ([]MetricPoint, localAppCoreTelemetryState, error)) {
	if appCoreTelemetryFn == nil {
		return
	}
	o.appCoreTelemetryFn = appCoreTelemetryFn
}

func (o *PlatformObserver) SetAppCoreMemoryFunc(appCoreMemoryFn func() (float64, float64, bool, error)) {
	if appCoreMemoryFn == nil {
		return
	}
	o.appCoreMemoryFn = appCoreMemoryFn
}

func (o *PlatformObserver) SetContainerStatsFunc(containerStatsFn func(context.Context) (string, error)) {
	if containerStatsFn == nil {
		return
	}
	o.containerStatsFn = containerStatsFn
}

func (o *PlatformObserver) SetHostTelemetryFunc(hostTelemetryFn func(time.Time, LocalHostTelemetryState) ([]monitormetrics.MetricPoint, LocalHostTelemetryState, error)) {
	if hostTelemetryFn == nil {
		return
	}
	o.hostTelemetryFn = hostTelemetryFn
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
	runtimeSettings := monitor.LoadPlatformSelfObservationRuntimeSettings(
		o.app,
		platformRuntimeCapabilityEnabled(EnvPlatformEnableHostTelemetry),
		platformRuntimeCapabilityEnabled(EnvPlatformEnableContainerTelemetry),
	)
	snapshot := RuntimeSnapshot{}
	if o.snapshotFn != nil {
		snapshot = o.snapshotFn()
	}
	resources := o.resourceFn([]int{os.Getpid()})
	resource := resources[os.Getpid()]
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	appCoreObservation, err := o.collectAppCoreTarget(now, snapshot, resource, mem)
	if err != nil {
		return err
	}
	platformMetricPoints := append([]monitormetrics.MetricPoint{}, appCoreObservation.Points...)
	workerMetricPoints, err := o.collectWorkerTarget(now, snapshot)
	if err != nil {
		return err
	}
	platformMetricPoints = append(platformMetricPoints, workerMetricPoints...)
	schedulerMetricPoints, err := o.collectSchedulerTarget(now, snapshot)
	if err != nil {
		return err
	}
	platformMetricPoints = append(platformMetricPoints, schedulerMetricPoints...)
	if o.appCoreTelemetryFn != nil {
		appCoreMetricPoints, nextAppCoreState, err := o.appCoreTelemetryFn(now, o.appCoreState)
		if err != nil {
			appCoreObservation.Summary["self_telemetry_state"] = "degraded"
			appCoreObservation.Summary["self_telemetry_reason"] = err.Error()
			slog.Warn("platform observer local app core telemetry skipped", "error", err)
		} else {
			o.appCoreState = nextAppCoreState
			appCoreObservation.Summary["self_telemetry_state"] = "healthy"
			platformMetricPoints = append(platformMetricPoints, appCoreMetricPoints...)
		}
	}
	if runtimeSettings.EnableHostTelemetry && o.hostTelemetryFn != nil {
		hostMetricPoints, nextHostState, err := o.hostTelemetryFn(now, o.hostState)
		if err != nil {
			slog.Warn("platform observer local host telemetry skipped", "error", err)
		} else {
			o.hostState = nextHostState
			platformMetricPoints = append(platformMetricPoints, hostMetricPoints...)
		}
	}
	if runtimeSettings.EnableContainerTelemetry {
		containerMetricPoints, err := o.collectLocalContainerTelemetry(context.Background(), now)
		if err != nil {
			slog.Warn("platform observer local container telemetry skipped", "error", err)
		} else {
			platformMetricPoints = append(platformMetricPoints, containerMetricPoints...)
		}
	}

	if err := monitormetrics.WriteMetricPoints(context.Background(), platformMetricPoints); err != nil {
		appCoreObservation.Summary["metrics_write_state"] = "failed"
		appCoreObservation.Summary["metrics_write_reason"] = err.Error()
		if projectErr := monitorstatus.ProjectPlatformLatestStatus(
			o.app,
			now,
			PlatformTargetAppOSCore,
			"AppOS Core",
			monitor.SignalSourceSelf,
			monitor.StatusDegraded,
			"platform metrics write failed",
			appCoreObservation.Summary,
		); projectErr != nil {
			slog.Warn("platform observer appos-core degraded status projection failed", "error", projectErr)
		}
		return err
	}

	appCoreStatus := monitor.StatusHealthy
	appCoreReason := ""
	if state := appCoreObservation.Summary["self_telemetry_state"]; state == "degraded" {
		appCoreStatus = monitor.StatusDegraded
		appCoreReason = "local app-core telemetry failed"
	}
	appCoreObservation.Summary["metrics_write_state"] = "healthy"
	if err := monitorstatus.ProjectPlatformLatestStatus(
		o.app,
		now,
		PlatformTargetAppOSCore,
		"AppOS Core",
		monitor.SignalSourceSelf,
		appCoreStatus,
		appCoreReason,
		appCoreObservation.Summary,
	); err != nil {
		return err
	}

	return nil
}

func (o *PlatformObserver) run(ctx context.Context) {
	if err := o.Collect(); err != nil {
		slog.Error("platform observer collect failed", "error", err)
	}
	for {
		settings := monitor.LoadPlatformSelfObservationRuntimeSettings(
			o.app,
			platformRuntimeCapabilityEnabled(EnvPlatformEnableHostTelemetry),
			platformRuntimeCapabilityEnabled(EnvPlatformEnableContainerTelemetry),
		)
		timer := time.NewTimer(settings.PlatformObserverInterval)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return
		case <-timer.C:
			if err := o.Collect(); err != nil {
				slog.Error("platform observer collect failed", "error", err)
			}
		}
	}
}
