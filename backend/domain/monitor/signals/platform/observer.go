package platform

import (
	"context"
	"os"
	"runtime"
	"time"

	"github.com/pocketbase/pocketbase/core"
	monitormetrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
	"github.com/websoft9/appos/backend/infra/supervisor"
)

func NewPlatformObserver(app core.App, snapshotFn func() RuntimeSnapshot) *PlatformObserver {
	return &PlatformObserver{
		app:        app,
		snapshotFn: snapshotFn,
		resourceFn: supervisor.GetProcessResources,
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

	if err := monitormetrics.WriteMetricPoints(context.Background(), platformMetricPoints); err != nil {
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
