package platform

import (
	"context"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
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
