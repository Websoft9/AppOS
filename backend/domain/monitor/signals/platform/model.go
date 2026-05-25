package platform

import (
	"context"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/infra/supervisor"
)

const (
	PlatformTargetAppOSCore = "appos-core"
	PlatformTargetWorker    = "worker"
	PlatformTargetScheduler = "scheduler"

	EnvPlatformEnableHostTelemetry      = "APPOS_PLATFORM_ENABLE_HOST_TELEMETRY"
	EnvPlatformEnableContainerTelemetry = "APPOS_PLATFORM_ENABLE_CONTAINER_TELEMETRY"

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
	app              core.App
	snapshotFn       func() RuntimeSnapshot
	resourceFn       func([]int) map[int]supervisor.ResourceInfo
	appCoreTelemetryFn func(time.Time, localAppCoreTelemetryState) ([]MetricPoint, localAppCoreTelemetryState, error)
	appCoreMemoryFn  func() (float64, float64, bool, error)
	hostTelemetryFn  func(time.Time, localHostTelemetryState) ([]MetricPoint, localHostTelemetryState, error)
	containerStatsFn func(context.Context) (string, error)
	nowFn            func() time.Time
	appCoreState     localAppCoreTelemetryState
	hostState        localHostTelemetryState
	containerSamples map[string]localContainerCounters
	mu               sync.Mutex
	cancel           context.CancelFunc
}

func platformRuntimeCapabilityEnabled(name string) bool {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return false
	}
	switch strings.ToLower(value) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
