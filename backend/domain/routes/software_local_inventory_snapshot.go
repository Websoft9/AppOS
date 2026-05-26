package routes

import (
	"context"
	"sync"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/software"
	swservice "github.com/websoft9/appos/backend/domain/software/service"
)

var loadProjectedLocalSoftwareComponents = func(app core.App) (map[software.ComponentKey]swservice.ComputedComponent, bool, error) {
	return swservice.New(app, asynqClient).ListSnapshotFirstLocalComponents()
}

var getSnapshotFirstLocalSoftwareComponent = func(app core.App, componentKey software.ComponentKey) (swservice.ComputedComponent, bool, error) {
	return swservice.New(app, asynqClient).GetLocalComponentSnapshotFirst(componentKey)
}

var warmLocalSoftwareInventorySnapshots = func(app core.App) {
	startLocalSoftwareInventorySnapshotRefresh(app)
}

var localSoftwareInventorySnapshotRefreshState = struct {
	mu         sync.Mutex
	refreshing bool
}{}

func startLocalSoftwareInventorySnapshotRefresh(app core.App) {
	localSoftwareInventorySnapshotRefreshState.mu.Lock()
	if localSoftwareInventorySnapshotRefreshState.refreshing {
		localSoftwareInventorySnapshotRefreshState.mu.Unlock()
		return
	}
	localSoftwareInventorySnapshotRefreshState.refreshing = true
	localSoftwareInventorySnapshotRefreshState.mu.Unlock()

	go func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				app.Logger().Error("panic while warming local software inventory snapshots", "panic", recovered)
			}
			localSoftwareInventorySnapshotRefreshState.mu.Lock()
			localSoftwareInventorySnapshotRefreshState.refreshing = false
			localSoftwareInventorySnapshotRefreshState.mu.Unlock()
		}()

		if _, err := swservice.New(app, asynqClient).ListLocalComponents(context.Background()); err != nil {
			app.Logger().Error("failed to warm local software inventory snapshots", "error", err)
		}
	}()
}