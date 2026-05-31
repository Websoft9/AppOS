package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		groupsCol, err := ensureGroupsCollection(app)
		if err != nil {
			return err
		}

		gi := core.NewBaseCollection("group_items")
		gi.ListRule = types.Pointer("@request.auth.id != ''")
		gi.ViewRule = types.Pointer("@request.auth.id != ''")
		gi.CreateRule = nil
		gi.UpdateRule = nil
		gi.DeleteRule = nil

		gi.Fields.Add(&core.RelationField{
			Name:          "group_id",
			CollectionId:  groupsCol.Id,
			Required:      true,
			CascadeDelete: true,
		})
		gi.Fields.Add(&core.TextField{Name: "object_type", Required: true, Max: 100})
		gi.Fields.Add(&core.TextField{Name: "object_id", Required: true, Max: 100})
		gi.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		gi.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
		gi.AddIndex("idx_group_items_unique", true, "group_id,object_type,object_id", "")

		return app.Save(gi)
	}, func(app core.App) error {
		if col, err := app.FindCollectionByNameOrId("group_items"); err == nil {
			return app.Delete(col)
		}
		return nil
	})
}
