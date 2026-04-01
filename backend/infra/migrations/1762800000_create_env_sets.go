package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Epic 24 — Story 24.1: Shared Envs Migration
//
// 1. Remove apps.env_groups relation field (unblock FK).
// 2. Delete old env_groups / env_group_vars collections (breaking change in MVP).
// 3. Create new env_sets + env_set_vars collections.
// 4. Add apps.env_sets ordered Relation[] field.
func init() {
	m.Register(func(app core.App) error {
		// ─── 1. Remove apps.env_groups field first (unblock FK) ──

		appCol, err := app.FindCollectionByNameOrId("apps")
		if err != nil {
			return err
		}
		appCol.Fields.RemoveByName("env_groups")
		if err := app.Save(appCol); err != nil {
			return err
		}

		// ─── 2. Remove legacy collections ────────────────────

		// Remove env_group_vars first (has FK to env_groups)
		if col, err := app.FindCollectionByNameOrId("env_group_vars"); err == nil {
			if err := app.Delete(col); err != nil {
				return err
			}
		}
		// Remove env_groups
		if col, err := app.FindCollectionByNameOrId("env_groups"); err == nil {
			if err := app.Delete(col); err != nil {
				return err
			}
		}

		// ─── 3. Create env_sets ──────────────────────────────

		envSets := core.NewBaseCollection("env_sets")
		envSets.ListRule = types.Pointer("@request.auth.id != ''")
		envSets.ViewRule = types.Pointer("@request.auth.id != ''")
		envSets.CreateRule = nil // superuser only
		envSets.UpdateRule = nil
		envSets.DeleteRule = nil

		envSets.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      200,
		})
		envSets.Fields.Add(&core.TextField{
			Name: "description",
		})
		envSets.AddIndex("idx_env_sets_name", true, "name", "")

		if err := app.Save(envSets); err != nil {
			return err
		}

		// ─── 4. Create env_set_vars ──────────────────────────

		secretsCol, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return err
		}

		envSetVars := core.NewBaseCollection("env_set_vars")
		envSetVars.ListRule = types.Pointer("@request.auth.id != ''")
		envSetVars.ViewRule = types.Pointer("@request.auth.id != ''")
		envSetVars.CreateRule = nil // superuser only
		envSetVars.UpdateRule = nil
		envSetVars.DeleteRule = nil

		envSetVars.Fields.Add(&core.RelationField{
			Name:          "set",
			CollectionId:  envSets.Id,
			Required:      true,
			MaxSelect:     1,
			CascadeDelete: true,
		})
		envSetVars.Fields.Add(&core.TextField{
			Name:     "key",
			Required: true,
			Max:      200,
		})
		envSetVars.Fields.Add(&core.TextField{
			Name: "value",
		})
		envSetVars.Fields.Add(&core.BoolField{
			Name: "is_secret",
		})
		envSetVars.Fields.Add(&core.RelationField{
			Name:         "secret",
			CollectionId: secretsCol.Id,
			MaxSelect:    1,
		})

		envSetVars.AddIndex("idx_env_set_vars_set", false, "`set`", "")
		envSetVars.AddIndex("idx_env_set_vars_set_key", true, "`set`, `key`", "")

		if err := app.Save(envSetVars); err != nil {
			return err
		}

		// ─── 5. Add apps.env_sets Relation[] ─────────────────

		// Re-fetch apps collection after earlier save
		appCol, err = app.FindCollectionByNameOrId("apps")
		if err != nil {
			return err
		}
		appCol.Fields.Add(&core.RelationField{
			Name:         "env_sets",
			CollectionId: envSets.Id,
			MaxSelect:    100,
		})
		return app.Save(appCol)

	}, func(app core.App) error {
		// Down: reverse the migration

		// Remove apps.env_sets
		if appCol, err := app.FindCollectionByNameOrId("apps"); err == nil {
			appCol.Fields.RemoveByName("env_sets")
			_ = app.Save(appCol)
		}

		// Drop new collections
		if col, err := app.FindCollectionByNameOrId("env_set_vars"); err == nil {
			_ = app.Delete(col)
		}
		if col, err := app.FindCollectionByNameOrId("env_sets"); err == nil {
			_ = app.Delete(col)
		}

		// Note: old env_groups / env_group_vars are NOT restored (MVP destructive change)
		return nil
	})
}
