package schema

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/assets"
)

func EnsureAssetsCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId(assets.Collection)
	if err != nil {
		col = core.NewBaseCollection(assets.Collection)
	}
	col.ListRule = authenticatedRule()
	col.ViewRule = authenticatedRule()
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "description", Max: 4000})
	addFieldIfMissing(col, &core.SelectField{Name: "kind", Required: true, MaxSelect: 1, Values: assets.SupportedKinds})
	addFieldIfMissing(col, &core.SelectField{Name: "storage_kind", Required: true, MaxSelect: 1, Values: assets.SupportedStorageKinds})
	addFieldIfMissing(col, &core.SelectField{Name: "source_kind", Required: true, MaxSelect: 1, Values: assets.SupportedSourceKinds})
	addFieldIfMissing(col, &core.SelectField{Name: "language", MaxSelect: 1, Values: assets.SupportedLanguages})
	addFieldIfMissing(col, &core.TextField{Name: "script_extension", Max: 32})
	addFieldIfMissing(col, &core.TextField{Name: "reference", Max: 4096})
	addFieldIfMissing(col, &core.TextField{Name: "path", Max: 1024})
	addFieldIfMissing(col, &core.TextField{Name: "entrypoint", Max: 512})
	addFieldIfMissing(col, &core.BoolField{Name: "is_system"})
	addFieldIfMissing(col, &core.BoolField{Name: "is_template"})
	addFieldIfMissing(col, &core.SelectField{Name: "prompt_scope", Values: assets.SupportedPromptScopes})
	addFieldIfMissing(col, &core.TextField{Name: "template_key", Max: 128})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_assets_kind", false, "kind", "")
	col.AddIndex("idx_assets_source_kind", false, "source_kind", "")
	return app.Save(col)
}
