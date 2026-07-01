package schema

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/media"
)

func EnsureMediaCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId(media.Collection)
	if err != nil {
		col = core.NewBaseCollection(media.Collection)
	}
	col.ListRule = authenticatedRule()
	col.ViewRule = authenticatedRule()
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.SelectField{Name: "category", Required: true, MaxSelect: 1, Values: media.SupportedCategories})
	addFieldIfMissing(col, &core.SelectField{Name: "scope", Required: true, MaxSelect: 1, Values: media.SupportedScopes})
	addFieldIfMissing(col, &core.SelectField{Name: "owner_type", Required: true, MaxSelect: 1, Values: media.SupportedOwnerTypes})
	addFieldIfMissing(col, &core.TextField{Name: "owner_id", Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "original_name", Required: true, Max: 255})
	addFieldIfMissing(col, &core.TextField{Name: "content_type", Required: true, Max: 120})
	addFieldIfMissing(col, &core.NumberField{Name: "size", Required: true, OnlyInt: true, Min: types.Pointer(0.0)})
	addFieldIfMissing(col, &core.TextField{Name: "storage_path", Required: true, Max: 1024})
	addFieldIfMissing(col, &core.TextField{Name: "public_url", Max: 1024})
	addFieldIfMissing(col, &core.TextField{Name: "created_by", Max: 64})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_media_scope_category", false, "scope, category", "")
	col.AddIndex("idx_media_owner", false, "owner_type, owner_id", "")
	return app.Save(col)
}
