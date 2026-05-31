package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/assets"
)

func init() {
	m.Register(func(app core.App) error {
		col := core.NewBaseCollection(assets.Collection)

		authRule := "@request.auth.id != ''"
		col.ListRule = types.Pointer(authRule)
		col.ViewRule = types.Pointer(authRule)
		col.CreateRule = nil
		col.UpdateRule = nil
		col.DeleteRule = nil

		col.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 200})
		col.Fields.Add(&core.TextField{Name: "description", Max: 4000})
		col.Fields.Add(&core.SelectField{Name: "kind", Required: true, MaxSelect: 1, Values: assets.SupportedKinds})
		col.Fields.Add(&core.SelectField{Name: "storage_kind", Required: true, MaxSelect: 1, Values: assets.SupportedStorageKinds})
		col.Fields.Add(&core.SelectField{Name: "source_kind", Required: true, MaxSelect: 1, Values: assets.SupportedSourceKinds})
		col.Fields.Add(&core.SelectField{Name: "language", MaxSelect: 1, Values: assets.SupportedLanguages})
		col.Fields.Add(&core.TextField{Name: "script_extension", Max: 32})
		col.Fields.Add(&core.TextField{Name: "reference", Max: 4096})
		col.Fields.Add(&core.TextField{Name: "path", Max: 1024})
		col.Fields.Add(&core.TextField{Name: "entrypoint", Max: 512})
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		col.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

		col.Indexes = []string{
			"CREATE INDEX idx_assets_kind ON assets (kind)",
			"CREATE INDEX idx_assets_source_kind ON assets (source_kind)",
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(assets.Collection)
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}
