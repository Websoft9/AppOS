package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/internal/settings"
	settingscatalog "github.com/websoft9/appos/backend/internal/settings/catalog"
)

// Story 13 MVP: Create and seed custom_settings for the current unified settings model.
//
// Access rules:
//   - List/View: superuser only
//   - Create/Update/Delete: nil = forbidden (all writes go through settings.SetGroup on the backend)
//
// Schema:
// Unique index on (module, key) ensures one row per logical group.
func init() {
	m.Register(func(app core.App) error {
		col := core.NewBaseCollection("custom_settings")

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
			"CREATE UNIQUE INDEX idx_custom_settings_module_key ON custom_settings (module, `key`)",
		}

		if err := app.Save(col); err != nil {
			return err
		}

		for _, row := range settingscatalog.SeedRows() {
			if err := settings.SetGroup(app, row.Module, row.Key, row.Value); err != nil {
				return err
			}
		}

		return nil
	}, func(app core.App) error {
		// Down: remove the collection
		col, err := app.FindCollectionByNameOrId("custom_settings")
		if err != nil {
			return nil // already gone
		}
		return app.Delete(col)
	})
}
