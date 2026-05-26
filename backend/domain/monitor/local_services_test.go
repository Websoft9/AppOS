package monitor

import (
	"sync"
	"testing"
	"time"

	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
	"github.com/websoft9/appos/backend/infra/supervisor"
)

func TestObserveLocalServicesReturnsFastSnapshotThenBackgroundCPU(t *testing.T) {
	originalProcessInfoFn := localServiceProcessInfoFn
	originalResourceFn := localServiceResourceFn
	originalMemoryFn := localServiceMemoryFn
	originalUptimeFn := localServiceUptimeFn
	originalCache := localServiceObservationCache

	localServiceObservationCache = struct {
		mu          sync.Mutex
		items       []LocalServiceObservation
		initialized bool
		refreshing  bool
	}{}

	t.Cleanup(func() {
		localServiceProcessInfoFn = originalProcessInfoFn
		localServiceResourceFn = originalResourceFn
		localServiceMemoryFn = originalMemoryFn
		localServiceUptimeFn = originalUptimeFn
		localServiceObservationCache = originalCache
	})

	registry := &swcatalog.LocalRegistry{
		Version: 1,
		Components: []swcatalog.LocalComponent{
			{ID: "appos", Name: "AppOS", Enabled: true},
		},
		Services: []swcatalog.LocalService{
			{Name: "appos", ComponentID: "appos", Enabled: true, Lifecycle: "always_on", Visibility: "default"},
		},
	}

	refreshed := make(chan struct{}, 1)
	localServiceProcessInfoFn = func() ([]supervisor.ProcessInfo, error) {
		return []supervisor.ProcessInfo{{Name: "appos", PID: 123, Uptime: 60, StateName: "RUNNING"}}, nil
	}
	localServiceMemoryFn = func([]int) map[int]int64 {
		return map[int]int64{123: 1024}
	}
	localServiceUptimeFn = func([]int) map[int]int64 {
		return map[int]int64{123: 60}
	}
	localServiceResourceFn = func([]int) map[int]supervisor.ResourceInfo {
		select {
		case refreshed <- struct{}{}:
		default:
		}
		return map[int]supervisor.ResourceInfo{123: {PID: 123, CPU: 1.5, Memory: 2048}}
	}

	first := ObserveLocalServices(registry)
	if len(first) != 1 {
		t.Fatalf("expected 1 service, got %d", len(first))
	}
	if first[0].CPU != 0 {
		t.Fatalf("expected fast snapshot CPU 0 before background refresh, got %v", first[0].CPU)
	}
	if first[0].Memory != 1024 {
		t.Fatalf("expected fast snapshot memory 1024, got %d", first[0].Memory)
	}
	if first[0].Uptime != 60 {
		t.Fatalf("expected fast snapshot uptime 60, got %d", first[0].Uptime)
	}

	select {
	case <-refreshed:
	case <-time.After(2 * time.Second):
		t.Fatal("expected background CPU refresh to complete")
	}

	second := ObserveLocalServices(registry)
	if len(second) != 1 {
		t.Fatalf("expected 1 service after refresh, got %d", len(second))
	}
	if second[0].CPU != 1.5 {
		t.Fatalf("expected cached CPU 1.5 after background refresh, got %v", second[0].CPU)
	}
	if second[0].Memory != 2048 {
		t.Fatalf("expected refreshed memory 2048 after background refresh, got %d", second[0].Memory)
	}
	if second[0].Uptime != 60 {
		t.Fatalf("expected cached uptime 60 after background refresh, got %d", second[0].Uptime)
	}
}
