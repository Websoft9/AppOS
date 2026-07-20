package monitor

import (
	"testing"
	"time"

	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
	"github.com/websoft9/appos/backend/infra/process"
)

func TestObserveLocalServicesReturnsFastSnapshotThenBackgroundCPU(t *testing.T) {
	originalProcessInfoFn := localServiceProcessInfoFn
	originalResourceFn := localServiceResourceFn
	originalMemoryFn := localServiceMemoryFn
	originalUptimeFn := localServiceUptimeFn
	originalItems := append([]LocalServiceObservation(nil), localServiceObservationCache.items...)
	originalInitialized := localServiceObservationCache.initialized
	originalRefreshing := localServiceObservationCache.refreshing

	localServiceObservationCache.mu.Lock()
	localServiceObservationCache.items = nil
	localServiceObservationCache.initialized = false
	localServiceObservationCache.refreshing = false
	localServiceObservationCache.mu.Unlock()

	t.Cleanup(func() {
		localServiceProcessInfoFn = originalProcessInfoFn
		localServiceResourceFn = originalResourceFn
		localServiceMemoryFn = originalMemoryFn
		localServiceUptimeFn = originalUptimeFn
		localServiceObservationCache.mu.Lock()
		localServiceObservationCache.items = append([]LocalServiceObservation(nil), originalItems...)
		localServiceObservationCache.initialized = originalInitialized
		localServiceObservationCache.refreshing = originalRefreshing
		localServiceObservationCache.mu.Unlock()
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
	localServiceProcessInfoFn = func([]process.MatchTarget) ([]process.ProcessInfo, error) {
		return []process.ProcessInfo{{Name: "appos", PID: 123, Uptime: 60, StateName: "running"}}, nil
	}
	localServiceMemoryFn = func([]int) map[int]int64 {
		return map[int]int64{123: 1024}
	}
	localServiceUptimeFn = func([]int) map[int]int64 {
		return map[int]int64{123: 60}
	}
	localServiceResourceFn = func([]int) map[int]process.ResourceInfo {
		select {
		case refreshed <- struct{}{}:
		default:
		}
		return map[int]process.ResourceInfo{123: {PID: 123, CPU: 1.5, Memory: 2048}}
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

func TestObserveLocalServicesNilRegistryReturnsEmpty(t *testing.T) {
	items := ObserveLocalServices(nil)
	if len(items) != 0 {
		t.Fatalf("expected empty result for nil registry, got %d items", len(items))
	}
}

func TestObserveLocalServicesTreatsMissingOnDemandServiceAsStopped(t *testing.T) {
	originalProcessInfoFn := localServiceProcessInfoFn
	originalItems := append([]LocalServiceObservation(nil), localServiceObservationCache.items...)
	originalInitialized := localServiceObservationCache.initialized
	originalRefreshing := localServiceObservationCache.refreshing

	localServiceObservationCache.mu.Lock()
	localServiceObservationCache.items = nil
	localServiceObservationCache.initialized = false
	localServiceObservationCache.refreshing = false
	localServiceObservationCache.mu.Unlock()

	t.Cleanup(func() {
		localServiceProcessInfoFn = originalProcessInfoFn
		localServiceObservationCache.mu.Lock()
		localServiceObservationCache.items = append([]LocalServiceObservation(nil), originalItems...)
		localServiceObservationCache.initialized = originalInitialized
		localServiceObservationCache.refreshing = originalRefreshing
		localServiceObservationCache.mu.Unlock()
	})

	localServiceProcessInfoFn = func([]process.MatchTarget) ([]process.ProcessInfo, error) {
		return nil, nil
	}

	registry := &swcatalog.LocalRegistry{
		Version: 1,
		Services: []swcatalog.LocalService{
			{Name: "traefik", ComponentID: "traefik", Enabled: true, Lifecycle: "on_demand", Visibility: "default"},
			{Name: "appos", ComponentID: "appos", Enabled: true, Lifecycle: "always_on", Visibility: "default"},
		},
	}

	items := observeLocalServicesSnapshot(registry, false)
	if len(items) != 2 {
		t.Fatalf("expected 2 services, got %d", len(items))
	}
	if items[0].State != "stopped" {
		t.Fatalf("expected on-demand service to be stopped when absent, got %q", items[0].State)
	}
	if items[1].State != "missing" {
		t.Fatalf("expected always-on service to remain missing when absent, got %q", items[1].State)
	}
}
