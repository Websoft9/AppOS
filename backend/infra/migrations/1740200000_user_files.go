package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		col := core.NewBaseCollection("user_files")

		ownerRule := "owner = @request.auth.id"
		col.ListRule = types.Pointer(ownerRule)
		col.ViewRule = types.Pointer(ownerRule)
		col.CreateRule = types.Pointer(ownerRule)
		col.UpdateRule = types.Pointer(ownerRule)
		col.DeleteRule = types.Pointer(ownerRule)

		col.Fields.Add(&core.TextField{Name: "owner", Required: true, Max: 64})
		col.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 500})
		col.Fields.Add(&core.FileField{Name: "content", MaxSelect: 1, MaxSize: 100 * 1024 * 1024})
		col.Fields.Add(&core.TextField{Name: "mime_type", Max: 200})
		col.Fields.Add(&core.TextField{Name: "share_token", Max: 128})
		col.Fields.Add(&core.TextField{Name: "share_expires_at", Max: 64})
		col.Fields.Add(&core.BoolField{Name: "is_folder"})
		col.Fields.Add(&core.TextField{Name: "parent", Max: 64})
		col.Fields.Add(&core.NumberField{Name: "size", Min: types.Pointer(0.0)})
		col.Fields.Add(&core.BoolField{Name: "is_deleted"})
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		col.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("user_files")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}