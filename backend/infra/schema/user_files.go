package schema

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

func EnsureUserFilesCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId("user_files")
	if err != nil {
		col = core.NewBaseCollection("user_files")
	}
	ownerRule := "owner = @request.auth.id"
	col.ListRule = types.Pointer(ownerRule)
	col.ViewRule = types.Pointer(ownerRule)
	col.CreateRule = types.Pointer(ownerRule)
	col.UpdateRule = types.Pointer(ownerRule)
	col.DeleteRule = types.Pointer(ownerRule)
	addFieldIfMissing(col, &core.TextField{Name: "owner", Required: true, Max: 64})
	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true, Max: 500})
	addFieldIfMissing(col, &core.FileField{Name: "content", MaxSelect: 1, MaxSize: 100 * 1024 * 1024})
	addFieldIfMissing(col, &core.TextField{Name: "mime_type", Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "share_token", Max: 128})
	addFieldIfMissing(col, &core.TextField{Name: "share_expires_at", Max: 64})
	addFieldIfMissing(col, &core.BoolField{Name: "is_folder"})
	addFieldIfMissing(col, &core.TextField{Name: "parent", Max: 64})
	addFieldIfMissing(col, &core.NumberField{Name: "size", Min: types.Pointer(0.0)})
	addFieldIfMissing(col, &core.BoolField{Name: "is_deleted"})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	return app.Save(col)
}
