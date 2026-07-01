package schema

import "github.com/pocketbase/pocketbase/core"

func EnsureCustomSettingsCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId("custom_settings")
	if err != nil {
		col = core.NewBaseCollection("custom_settings")
	}
	rule := "@request.auth.collectionName = '_superusers'"
	col.ListRule = &rule
	col.ViewRule = &rule
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.TextField{Name: "module", Required: true})
	addFieldIfMissing(col, &core.TextField{Name: "key", Required: true})
	addFieldIfMissing(col, &core.JSONField{Name: "value"})
	col.AddIndex("idx_custom_settings_module_key", true, "module, `key`", "")
	return app.Save(col)
}
