package migrations

// Groups domain — single consolidated migration (MVP).
//
// Creates:
//   - `groups`     collection (name, description, created_by, is_default)
//   - `group_items` collection (group_id → groups, object_type, object_id)
//
// Seeded data:
//   - One "default" group with is_default = true
//
// ObjectType values stored in group_items.object_type must stay in sync with
// domain/groups/query.go ObjectType constants and
// dashboard/src/lib/object-types.ts.

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		// ─── 1. groups collection ─────────────────────────────
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
		g.Fields.Add(&core.BoolField{
			Name: "is_default",
		})
		g.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		g.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
		g.AddIndex("idx_groups_name", true, "name", "")

		if err := app.Save(g); err != nil {
			return err
		}

		// ─── 2. group_items collection ────────────────────────
		gi := core.NewBaseCollection("group_items")
		gi.ListRule = types.Pointer("@request.auth.id != ''")
		gi.ViewRule = types.Pointer("@request.auth.id != ''")
		gi.CreateRule = nil // superuser only
		gi.UpdateRule = nil
		gi.DeleteRule = nil

		gi.Fields.Add(&core.RelationField{
			Name:          "group_id",
			CollectionId:  g.Id,
			Required:      true,
			CascadeDelete: true,
		})
		gi.Fields.Add(&core.TextField{
			Name:     "object_type",
			Required: true,
			Max:      100,
		})
		gi.Fields.Add(&core.TextField{
			Name:     "object_id",
			Required: true,
			Max:      100,
		})
		gi.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		gi.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
		gi.AddIndex("idx_group_items_unique", true, "group_id,object_type,object_id", "")

		if err := app.Save(gi); err != nil {
			return err
		}

		// ─── 3. Seed "default" group ──────────────────────────
		defaultGroup := core.NewRecord(g)
		defaultGroup.Set("name", "default")
		defaultGroup.Set("description", "Default group")
		defaultGroup.Set("is_default", true)
		return app.Save(defaultGroup)

	}, func(app core.App) error {
		// Down: delete group_items first (FK to groups), then groups.
		if col, err := app.FindCollectionByNameOrId("group_items"); err == nil {
			_ = app.Delete(col)
		}
		if col, err := app.FindCollectionByNameOrId("groups"); err == nil {
			_ = app.Delete(col)
		}
		return nil
	})
}
