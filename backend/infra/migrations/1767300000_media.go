package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/media"
)

func init() {
	m.Register(func(app core.App) error {
		col := core.NewBaseCollection(media.Collection)

		authRule := "@request.auth.id != ''"
		col.ListRule = types.Pointer(authRule)
		col.ViewRule = types.Pointer(authRule)
		col.CreateRule = nil
		col.UpdateRule = nil
		col.DeleteRule = nil

		col.Fields.Add(&core.SelectField{Name: "category", Required: true, MaxSelect: 1, Values: media.SupportedCategories})
		col.Fields.Add(&core.SelectField{Name: "scope", Required: true, MaxSelect: 1, Values: media.SupportedScopes})
		col.Fields.Add(&core.SelectField{Name: "owner_type", Required: true, MaxSelect: 1, Values: media.SupportedOwnerTypes})
		col.Fields.Add(&core.TextField{Name: "owner_id", Max: 200})
		col.Fields.Add(&core.TextField{Name: "original_name", Required: true, Max: 255})
		col.Fields.Add(&core.TextField{Name: "content_type", Required: true, Max: 120})
		col.Fields.Add(&core.NumberField{Name: "size", Required: true, OnlyInt: true, Min: types.Pointer(0.0)})
		col.Fields.Add(&core.TextField{Name: "storage_path", Required: true, Max: 1024})
		col.Fields.Add(&core.TextField{Name: "public_url", Max: 1024})
		col.Fields.Add(&core.TextField{Name: "created_by", Max: 64})
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		col.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

		col.Indexes = []string{
			"CREATE INDEX idx_media_scope_category ON media (scope, category)",
			"CREATE INDEX idx_media_owner ON media (owner_type, owner_id)",
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(media.Collection)
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}
