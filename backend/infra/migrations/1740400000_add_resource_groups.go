package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Story 8.6: Resource Groups
//
//  1. Create `resource_groups` collection (name, description, is_default)
//  2. Seed the "default" group record
//  3. Add `groups` Relation[] field to all 8 resource collections
//  4. Back-fill existing records with the default group id

// allResourceCollections lists all 8 resource collection names that carry a groups field.
var allResourceCollections = []string{
	"servers", "secrets", "env_groups",
	"databases", "cloud_accounts", "certificates",
	"integrations", "scripts",
}

func init() {
	m.Register(func(app core.App) error {
		// ─── 1. resource_groups collection ───────────────────
		rg := core.NewBaseCollection("resource_groups")
		rg.ListRule = types.Pointer("@request.auth.id != ''")
		rg.ViewRule = types.Pointer("@request.auth.id != ''")
		rg.CreateRule = nil
		rg.UpdateRule = nil
		rg.DeleteRule = nil

		rg.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      200,
		})
		rg.Fields.Add(&core.TextField{
			Name: "description",
		})
		rg.Fields.Add(&core.BoolField{
			Name: "is_default",
		})
		rg.AddIndex("idx_resource_groups_name", true, "name", "")

		if err := app.Save(rg); err != nil {
			return err
		}

		// ─── 2. Seed "default" group ─────────────────────────
		defaultGroup := core.NewRecord(rg)
		defaultGroup.Set("name", "default")
		defaultGroup.Set("description", "Default resource group")
		defaultGroup.Set("is_default", true)
		if err := app.Save(defaultGroup); err != nil {
			return err
		}
		defaultGroupId := defaultGroup.Id

		// ─── 3. Add `groups` field to all 8 resource collections ──
		for _, colName := range allResourceCollections {
			col, err := app.FindCollectionByNameOrId(colName)
			if err != nil {
				return err
			}
			col.Fields.Add(&core.RelationField{
				Name:         "groups",
				CollectionId: rg.Id,
				MaxSelect:    100,
			})
			if err := app.Save(col); err != nil {
				return err
			}
		}

		// ─── 4. Back-fill existing records ────────────────────
		for _, colName := range allResourceCollections {
			records, err := app.FindAllRecords(colName)
			if err != nil {
				return err
			}
			for _, rec := range records {
				rec.Set("groups", []string{defaultGroupId})
				if err := app.Save(rec); err != nil {
					return err
				}
			}
		}

		return nil
	}, func(app core.App) error {
		// Down: remove `groups` field from all 8 collections, then delete resource_groups
		for _, colName := range allResourceCollections {
			col, err := app.FindCollectionByNameOrId(colName)
			if err != nil {
				continue
			}
			col.Fields.RemoveByName("groups")
			_ = app.Save(col)
		}

		col, err := app.FindCollectionByNameOrId("resource_groups")
		if err != nil {
			return nil // already deleted
		}
		return app.Delete(col)
	})
}
