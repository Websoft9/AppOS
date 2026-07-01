package schema

import "github.com/pocketbase/pocketbase/core"

func EnsureGroupItemsCollection(app core.App) error {
	groupsCol, err := app.FindCollectionByNameOrId("groups")
	if err != nil {
		return err
	}
	col, err := app.FindCollectionByNameOrId("group_items")
	if err != nil {
		col = core.NewBaseCollection("group_items")
	}
	col.ListRule = authenticatedRule()
	col.ViewRule = authenticatedRule()
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.RelationField{Name: "group_id", CollectionId: groupsCol.Id, Required: true, CascadeDelete: true, MaxSelect: 1})
	addFieldIfMissing(col, &core.TextField{Name: "object_type", Required: true, Max: 100})
	addFieldIfMissing(col, &core.TextField{Name: "object_id", Required: true, Max: 100})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_group_items_unique", true, "group_id,object_type,object_id", "")
	return app.Save(col)
}
