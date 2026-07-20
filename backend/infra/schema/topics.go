package schema

import "github.com/pocketbase/pocketbase/core"

func EnsureTopicsCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId("topics")
	if err != nil {
		col = core.NewBaseCollection("topics")
	}
	authRule := "@request.auth.id != ''"
	ownerRule := "created_by = @request.auth.id"
	col.ListRule = &authRule
	col.ViewRule = &authRule
	col.CreateRule = &authRule
	col.UpdateRule = &ownerRule
	col.DeleteRule = &ownerRule
	addFieldIfMissing(col, &core.TextField{Name: "title", Required: true, Max: 500})
	addFieldIfMissing(col, &core.TextField{Name: "description"})
	addFieldIfMissing(col, &core.TextField{Name: "created_by", Required: true, Max: 100})
	addFieldIfMissing(col, &core.BoolField{Name: "closed"})
	addFieldIfMissing(col, &core.TextField{Name: "share_token", Max: 128})
	addFieldIfMissing(col, &core.TextField{Name: "share_expires_at", Max: 64})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	return app.Save(col)
}
