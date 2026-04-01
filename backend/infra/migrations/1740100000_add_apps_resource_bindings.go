package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds the apps collection with resource binding fields.
//
// Core fields: name
// Resource bindings: env_vars (JSON), credentials (JSON, encrypted at app layer),
// and Relation fields to servers, secrets, env_groups, databases,
// cloud_accounts, certificates.
func init() {
	m.Register(func(app core.App) error {
		col := core.NewBaseCollection("apps")

		col.ListRule = nil // superuser only
		col.ViewRule = nil
		col.CreateRule = nil
		col.UpdateRule = nil
		col.DeleteRule = nil

		// ─── Core fields ──────────────────────────
		col.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      200,
		})

		// ─── Resource bindings ────────────────────

		// Inline non-sensitive key-value config (e.g., {"PORT": "3000"})
		col.Fields.Add(&core.JSONField{
			Name:    "env_vars",
			MaxSize: 102400, // 100 KB
		})

		// Inline sensitive key-value config, encrypted at application layer
		col.Fields.Add(&core.JSONField{
			Name:    "credentials",
			MaxSize: 102400,
			Hidden:  true,
		})

		// Single server target
		serverCol, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return err
		}
		col.Fields.Add(&core.RelationField{
			Name:         "server",
			CollectionId: serverCol.Id,
			MaxSelect:    1,
		})

		// Multiple secrets
		secretCol, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return err
		}
		col.Fields.Add(&core.RelationField{
			Name:         "secrets",
			CollectionId: secretCol.Id,
			MaxSelect:    100,
		})

		// Multiple env groups
		envGroupCol, err := app.FindCollectionByNameOrId("env_groups")
		if err != nil {
			return err
		}
		col.Fields.Add(&core.RelationField{
			Name:         "env_groups",
			CollectionId: envGroupCol.Id,
			MaxSelect:    100,
		})

		// Multiple databases
		dbCol, err := app.FindCollectionByNameOrId("databases")
		if err != nil {
			return err
		}
		col.Fields.Add(&core.RelationField{
			Name:         "databases",
			CollectionId: dbCol.Id,
			MaxSelect:    100,
		})

		// Multiple cloud accounts
		caCol, err := app.FindCollectionByNameOrId("cloud_accounts")
		if err != nil {
			return err
		}
		col.Fields.Add(&core.RelationField{
			Name:         "cloud_accounts",
			CollectionId: caCol.Id,
			MaxSelect:    100,
		})

		// Multiple certificates
		certCol, err := app.FindCollectionByNameOrId("certificates")
		if err != nil {
			return err
		}
		col.Fields.Add(&core.RelationField{
			Name:         "certificates",
			CollectionId: certCol.Id,
			MaxSelect:    100,
		})

		if err := app.Save(col); err != nil {
			return err
		}

		// Unique name index
		_, err = app.DB().NewQuery("CREATE UNIQUE INDEX IF NOT EXISTS idx_apps_name ON apps (name)").Execute()
		return err
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("apps")
		if err == nil {
			return app.Delete(col)
		}
		return nil // already deleted
	})
}
