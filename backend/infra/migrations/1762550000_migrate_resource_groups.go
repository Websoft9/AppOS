package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Story 21.3: Groups Migration
//
// Migrates legacy `resource_groups` / per-object `groups` fields into the
// new Groups model (`groups` + `group_items`) introduced in Story 21.1.
//
// Steps (all idempotent):
//  1. For each `resource_groups` record, upsert a matching `groups` record.
//  2. For each resource collection record that has a legacy `groups` field,
//     insert a `group_items` row per referenced group (unique index prevents
//     duplicates on re-run).
//  3. Remove the `groups` relation field from all 8 resource collections.
//  4. Delete the `resource_groups` collection itself.

// collectionToObjectType maps PocketBase collection name -> group_items.object_type.
// Must be consistent with dashboard/src/lib/object-types.ts.
var collectionToObjectType = map[string]string{
	"servers":        "server",
	"secrets":        "secret",
	"env_groups":     "env_group",
	"databases":      "database",
	"cloud_accounts": "cloud_account",
	"certificates":   "certificate",
	"integrations":   "integration",
	"scripts":        "script",
}

func init() {
	m.Register(func(app core.App) error {
		if err := migrateResourceGroupsData(app); err != nil {
			return err
		}
		if err := removeLegacyGroupsFields(app); err != nil {
			return err
		}
		return dropResourceGroupsCollection(app)
	}, func(app core.App) error {
		// Down: no rollback — data in the new model is the source of truth.
		return nil
	})
}

// migrateResourceGroupsData copies resource_groups → groups and per-object
// groups relation fields → group_items. Skipped entirely when resource_groups
// no longer exists (idempotent re-run after collection was dropped).
func migrateResourceGroupsData(app core.App) error {
	legacyGroups, err := app.FindAllRecords("resource_groups")
	if err != nil {
		return nil // collection doesn't exist; skip
	}

	// ─── 1. Migrate resource_groups → groups ──────────────
	gCol, err := app.FindCollectionByNameOrId("groups")
	if err != nil {
		return err
	}

	// idMapping: old resource_groups.id → new groups.id
	idMapping := map[string]string{}

	for _, lg := range legacyGroups {
		legacyName := lg.GetString("name")

		// Idempotent: look up existing groups record by name.
		existing, err := app.FindFirstRecordByData("groups", "name", legacyName)
		if err == nil {
			idMapping[lg.Id] = existing.Id
			continue
		}

		newGroup := core.NewRecord(gCol)
		newGroup.Set("name", legacyName)
		newGroup.Set("description", lg.GetString("description"))
		if err := app.Save(newGroup); err != nil {
			return err
		}
		idMapping[lg.Id] = newGroup.Id
	}

	// ─── 2. Migrate per-object groups field → group_items ──
	giCol, err := app.FindCollectionByNameOrId("group_items")
	if err != nil {
		return err
	}

	for colName, objectType := range collectionToObjectType {
		col, err := app.FindCollectionByNameOrId(colName)
		if err != nil {
			continue // collection may not exist
		}
		// Only proceed if this collection still carries the legacy `groups` field.
		if col.Fields.GetByName("groups") == nil {
			continue
		}

		records, err := app.FindAllRecords(colName)
		if err != nil {
			return err
		}

		for _, rec := range records {
			legacyGroupIds := rec.GetStringSlice("groups")
			for _, oldId := range legacyGroupIds {
				newGroupId, ok := idMapping[oldId]
				if !ok {
					continue // unknown legacy group; skip
				}
				// Idempotent: unique index on (group_id, object_type, object_id) prevents
				// duplicates, but Save would return an error, so check first.
				existing, _ := app.FindFirstRecordByFilter(
					"group_items",
					"group_id = {:gid} && object_type = {:ot} && object_id = {:oid}",
					map[string]any{
						"gid": newGroupId,
						"ot":  objectType,
						"oid": rec.Id,
					},
				)
				if existing != nil {
					continue // already migrated
				}

				item := core.NewRecord(giCol)
				item.Set("group_id", newGroupId)
				item.Set("object_type", objectType)
				item.Set("object_id", rec.Id)
				if err := app.Save(item); err != nil {
					return err
				}
			}
		}
	}

	return nil
}

// removeLegacyGroupsFields drops the `groups` relation field from all 8
// resource collections. Safe to call multiple times (checks field existence).
func removeLegacyGroupsFields(app core.App) error {
	for colName := range collectionToObjectType {
		col, err := app.FindCollectionByNameOrId(colName)
		if err != nil {
			continue
		}
		if col.Fields.GetByName("groups") == nil {
			continue // already removed
		}
		col.Fields.RemoveByName("groups")
		if err := app.Save(col); err != nil {
			return err
		}
	}
	return nil
}

// dropResourceGroupsCollection deletes the resource_groups collection.
// No-ops when the collection no longer exists.
func dropResourceGroupsCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId("resource_groups")
	if err != nil {
		return nil // already gone
	}
	return app.Delete(col)
}
