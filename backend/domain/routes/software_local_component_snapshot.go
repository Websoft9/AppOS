package routes

import (
	"strings"
	"sync"

	"github.com/pocketbase/pocketbase/core"
	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
	swinventory "github.com/websoft9/appos/backend/domain/software/inventory"
)

type localComponentProbeState struct {
	Version      string
	Available    bool
	ProbePending bool
}

var localComponentProbeCache = struct {
	mu         sync.Mutex
	items      map[string]localComponentProbeState
	refreshing bool
}{
	items: map[string]localComponentProbeState{},
}

func currentLocalComponentProbeStates(registry *swcatalog.LocalRegistry) map[string]localComponentProbeState {
	localComponentProbeCache.mu.Lock()
	defer localComponentProbeCache.mu.Unlock()

	states := make(map[string]localComponentProbeState, len(registry.EnabledComponents()))
	for _, component := range registry.EnabledComponents() {
		state, ok := localComponentProbeCache.items[component.ID]
		if !ok {
			state = localComponentProbeState{
				Version:      "unknown",
				Available:    false,
				ProbePending: true,
			}
		}
		states[component.ID] = state
	}
	return states
}

func startLocalComponentProbeRefresh(app core.App, registry *swcatalog.LocalRegistry) {
	localComponentProbeCache.mu.Lock()
	if localComponentProbeCache.refreshing {
		localComponentProbeCache.mu.Unlock()
		return
	}
	localComponentProbeCache.refreshing = true
	localComponentProbeCache.mu.Unlock()

	go func() {
		states := computeLocalComponentProbeStates(app, registry)
		localComponentProbeCache.mu.Lock()
		localComponentProbeCache.items = states
		localComponentProbeCache.refreshing = false
		localComponentProbeCache.mu.Unlock()
	}()
}

func computeLocalComponentProbeStates(app core.App, registry *swcatalog.LocalRegistry) map[string]localComponentProbeState {
	states := make(map[string]localComponentProbeState, len(registry.EnabledComponents()))
	for _, component := range registry.EnabledComponents() {
		version, err := swinventory.DetectVersion(app, component.VersionProbe)
		if err != nil || strings.TrimSpace(version) == "" {
			version = "unknown"
		}
		available, availabilityErr := swinventory.CheckAvailability(app, component.AvailabilityProbe)
		if availabilityErr != nil {
			available = false
		}
		states[component.ID] = localComponentProbeState{
			Version:      version,
			Available:    available,
			ProbePending: false,
		}
	}
	return states
}
