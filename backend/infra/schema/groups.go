package schema

import "github.com/pocketbase/pocketbase/core"

func EnsureGroupsCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId("groups")
	if err != nil {
		col = core.NewBaseCollection("groups")
	}
	col.ListRule = authenticatedRule()
	col.ViewRule = authenticatedRule()
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "description"})
	addFieldIfMissing(col, &core.TextField{Name: "created_by", Max: 100})
	addFieldIfMissing(col, &core.BoolField{Name: "is_default"})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_groups_name", true, "name", "")
	return app.Save(col)
}
