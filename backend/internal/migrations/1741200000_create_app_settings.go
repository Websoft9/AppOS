package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Story 13.1: Create app_settings BaseCollection for centralized extension settings.
//
// Access rules:
//   - List/View: superuser only
//   - Create/Update/Delete: nil = forbidden (all writes go through settings.SetGroup on the backend)
//
// Schema:
//
//	module  — which subsystem owns the row (e.g. "files", "proxy")
//	key     — group name within the module (e.g. "quota", "network")
//	value   — JSON blob holding all fields for that group
//
// Unique index on (module, key) ensures one row per logical group.
func init() {
	m.Register(func(app core.App) error {
		col := core.NewBaseCollection("app_settings")

		col.Fields.Add(&core.TextField{Name: "module", Required: true})
		col.Fields.Add(&core.TextField{Name: "key", Required: true})
		col.Fields.Add(&core.JSONField{Name: "value"})

		// Only superusers may read rows via the standard PB API.
		// All backend code bypasses rules via app.Save() / app.FindFirstRecordByFilter().
		rule := "@request.auth.collectionName = '_superusers'"
		col.ListRule = &rule
		col.ViewRule = &rule

		// Mutation from client side is forbidden; backend writes via app.Save().
		col.CreateRule = nil
		col.UpdateRule = nil
		col.DeleteRule = nil

		// Unique constraint to prevent duplicate module/key rows.
		col.Indexes = []string{
			"CREATE UNIQUE INDEX idx_app_settings_module_key ON app_settings (module, `key`)",
		}

		return app.Save(col)
	}, func(app core.App) error {
		// Down: remove the collection
		col, err := app.FindCollectionByNameOrId("app_settings")
		if err != nil {
			return nil // already gone
		}
		return app.Delete(col)
	})
}
