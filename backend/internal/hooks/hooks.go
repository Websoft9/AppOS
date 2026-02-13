// Package hooks registers PocketBase event hooks for AppOS business logic.
package hooks

import (
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// Register binds all custom event hooks to the PocketBase app.
func Register(app *pocketbase.PocketBase) {
	registerAppHooks(app)
}

// registerAppHooks registers hooks related to the apps collection.
func registerAppHooks(app *pocketbase.PocketBase) {
	// Example: auto-cleanup when an app record is deleted
	app.OnRecordAfterDeleteSuccess("apps").BindFunc(func(e *core.RecordEvent) error {
		// TODO: cleanup Docker resources, proxy config, etc.
		return e.Next()
	})

	// Example: validate app record before creation
	app.OnRecordCreate("apps").BindFunc(func(e *core.RecordEvent) error {
		// TODO: validate app configuration
		return e.Next()
	})
}
