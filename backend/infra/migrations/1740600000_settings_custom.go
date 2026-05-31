package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingsschema "github.com/websoft9/appos/backend/domain/config/sysconfig/schema"
)

// Story 13 MVP: Create and seed custom_settings for the current unified settings model.
func init() {
	m.Register(func(app core.App) error {
		col := core.NewBaseCollection("custom_settings")

		col.Fields.Add(&core.TextField{Name: "module", Required: true})
		col.Fields.Add(&core.TextField{Name: "key", Required: true})
		col.Fields.Add(&core.JSONField{Name: "value"})

		rule := "@request.auth.collectionName = '_superusers'"
		col.ListRule = &rule
		col.ViewRule = &rule
		col.CreateRule = nil
		col.UpdateRule = nil
		col.DeleteRule = nil

		col.Indexes = []string{
			"CREATE UNIQUE INDEX idx_custom_settings_module_key ON custom_settings (module, `key`)",
		}

		if err := app.Save(col); err != nil {
			return err
		}

		for _, row := range settingsschema.SeedRows() {
			if err := sysconfig.SetGroup(app, row.Module, row.Key, row.Value); err != nil {
				return err
			}
		}

		return nil
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("custom_settings")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}
