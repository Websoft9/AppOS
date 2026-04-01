package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Story 21.1: Groups Backend
//
//  1. Create `groups` collection (name, description)
//  2. Create `group_items` collection (group_id, object_type, object_id)
//     with cascade-delete on group_id and composite unique index.

func init() {
	m.Register(func(app core.App) error {
		// ─── 1. groups collection ────────────────────────────
		g := core.NewBaseCollection("groups")
		g.ListRule = types.Pointer("@request.auth.id != ''")
		g.ViewRule = types.Pointer("@request.auth.id != ''")
		g.CreateRule = nil // superuser only
		g.UpdateRule = nil
		g.DeleteRule = nil

		g.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      200,
		})
		g.Fields.Add(&core.TextField{
			Name: "description",
		})
		g.Fields.Add(&core.TextField{
			Name: "created_by",
			Max:  100,
		})
		g.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		g.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
		g.AddIndex("idx_groups_name", true, "name", "")

		if err := app.Save(g); err != nil {
			return err
		}

		// ─── 2. group_items collection ───────────────────────
		gm := core.NewBaseCollection("group_items")
		gm.ListRule = types.Pointer("@request.auth.id != ''")
		gm.ViewRule = types.Pointer("@request.auth.id != ''")
		gm.CreateRule = nil // superuser only
		gm.UpdateRule = nil
		gm.DeleteRule = nil

		gm.Fields.Add(&core.RelationField{
			Name:          "group_id",
			CollectionId:  g.Id,
			Required:      true,
			CascadeDelete: true,
		})
		gm.Fields.Add(&core.TextField{
			Name:     "object_type",
			Required: true,
			Max:      100,
		})
		gm.Fields.Add(&core.TextField{
			Name:     "object_id",
			Required: true,
			Max:      100,
		})
		gm.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		gm.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
		gm.AddIndex("idx_group_items_unique", true, "group_id,object_type,object_id", "")

		if err := app.Save(gm); err != nil {
			return err
		}

		return nil
	}, func(app core.App) error {
		// Down: delete group_items first (has FK to groups), then groups.
		if col, err := app.FindCollectionByNameOrId("group_items"); err == nil {
			_ = app.Delete(col)
		}
		if col, err := app.FindCollectionByNameOrId("groups"); err == nil {
			_ = app.Delete(col)
		}
		return nil
	})
}
