package migrations

// Groups domain — single-table schema migration for the groups collection.
//
// Seeded data:
//   - One "default" group with is_default = true

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		g, err := ensureGroupsCollection(app)
		if err != nil {
			return err
		}

		defaultGroup, err := app.FindFirstRecordByFilter("groups", "name = 'default'")
		if err == nil && defaultGroup != nil {
			return nil
		}

		record := core.NewRecord(g)
		record.Set("name", "default")
		record.Set("description", "Default group")
		record.Set("is_default", true)
		return app.Save(record)

	}, func(app core.App) error {
		if col, err := app.FindCollectionByNameOrId("groups"); err == nil {
			return app.Delete(col)
		}
		return nil
	})
}

func ensureGroupsCollection(app core.App) (*core.Collection, error) {
	if existing, err := app.FindCollectionByNameOrId("groups"); err == nil {
		return existing, nil
	}

	g := core.NewBaseCollection("groups")
	g.ListRule = types.Pointer("@request.auth.id != ''")
	g.ViewRule = types.Pointer("@request.auth.id != ''")
	g.CreateRule = nil
	g.UpdateRule = nil
	g.DeleteRule = nil

	g.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 200})
	g.Fields.Add(&core.TextField{Name: "description"})
	g.Fields.Add(&core.TextField{Name: "created_by", Max: 100})
	g.Fields.Add(&core.BoolField{Name: "is_default"})
	g.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	g.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	g.AddIndex("idx_groups_name", true, "name", "")

	if err := app.Save(g); err != nil {
		return nil, err
	}
	return g, nil
}
