package platform

import (
	"context"
	"log/slog"
	"os"
	"runtime"
	"time"

	"github.com/pocketbase/pocketbase/core"
	monitormetrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
	"github.com/websoft9/appos/backend/infra/docker"
	"github.com/websoft9/appos/backend/infra/supervisor"
)

func NewPlatformObserver(app core.App, snapshotFn func() RuntimeSnapshot) *PlatformObserver {
	localDockerClient := docker.New(docker.NewLocalExecutor(""))

	var hostTelemetryFn func(time.Time, localHostTelemetryState) ([]MetricPoint, localHostTelemetryState, error)
	if platformRuntimeCapabilityEnabled(EnvPlatformEnableHostTelemetry) {
		hostTelemetryFn = collectLocalHostMetricPoints
	}

	var containerStatsFn func(context.Context) (string, error)
	if platformRuntimeCapabilityEnabled(EnvPlatformEnableContainerTelemetry) {
		containerStatsFn = localDockerClient.ContainerStats
	}

	return &PlatformObserver{
		app:              app,
		snapshotFn:       snapshotFn,
		resourceFn:       supervisor.GetProcessResources,
		appCoreTelemetryFn: collectLocalAppCoreMetricPoints,
		hostTelemetryFn:  hostTelemetryFn,
		containerStatsFn: containerStatsFn,
		containerSamples: map[string]localContainerCounters{},
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

func (o *PlatformObserver) SetResourceFunc(resourceFn func([]int) map[int]supervisor.ResourceInfo) {
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
	snapshot := RuntimeSnapshot{}
	if o.snapshotFn != nil {
		snapshot = o.snapshotFn()
	}
	resources := o.resourceFn([]int{os.Getpid()})
	resource := resources[os.Getpid()]
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	platformMetricPoints, err := o.collectAppCoreTarget(now, snapshot, resource, mem)
	if err != nil {
		return err
	}
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
			slog.Warn("platform observer local app core telemetry skipped", "error", err)
		} else {
			o.appCoreState = nextAppCoreState
			platformMetricPoints = append(platformMetricPoints, appCoreMetricPoints...)
		}
	}
	if o.hostTelemetryFn != nil {
		hostMetricPoints, nextHostState, err := o.hostTelemetryFn(now, o.hostState)
		if err != nil {
			slog.Warn("platform observer local host telemetry skipped", "error", err)
		} else {
			o.hostState = nextHostState
			platformMetricPoints = append(platformMetricPoints, hostMetricPoints...)
		}
	}
	containerMetricPoints, err := o.collectLocalContainerTelemetry(context.Background(), now)
	if err != nil {
		slog.Warn("platform observer local container telemetry skipped", "error", err)
	} else {
		platformMetricPoints = append(platformMetricPoints, containerMetricPoints...)
	}

	if err := monitormetrics.WriteMetricPoints(context.Background(), platformMetricPoints); err != nil {
		return err
	}

	return nil
}

func (o *PlatformObserver) run(ctx context.Context) {
	if err := o.Collect(); err != nil {
		slog.Error("platform observer collect failed", "error", err)
	}
	ticker := time.NewTicker(PlatformObserverInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := o.Collect(); err != nil {
				slog.Error("platform observer collect failed", "error", err)
			}
		}
	}
}
