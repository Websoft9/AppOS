package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Epic 8: Resource Store — create all resource collections.
//
// Collections are created in dependency order:
//  1. secrets       (no deps)
//  2. env_groups    (no deps)
//  3. env_group_vars (→ env_groups, secrets)
//  4. servers       (→ secrets)
//  5. databases     (→ secrets)
//  6. cloud_accounts (→ secrets)
//  7. certificates  (→ secrets)
func init() {
	m.Register(func(app core.App) error {
		// ─── 1. secrets ──────────────────────────────────────
		secrets := core.NewBaseCollection("secrets")
		secrets.ListRule = nil // superuser only
		secrets.ViewRule = nil
		secrets.CreateRule = nil
		secrets.UpdateRule = nil
		secrets.DeleteRule = nil

		secrets.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      200,
		})
		secrets.Fields.Add(&core.SelectField{
			Name:      "type",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"password", "api_key", "token", "ssh_key"},
		})
		secrets.Fields.Add(&core.TextField{
			Name:   "value",
			Hidden: true, // never exposed in API list responses
		})
		secrets.Fields.Add(&core.TextField{
			Name: "description",
		})
		secrets.AddIndex("idx_secrets_name", true, "name", "")

		if err := app.Save(secrets); err != nil {
			return err
		}

		// ─── 2. env_groups ───────────────────────────────────
		envGroups := core.NewBaseCollection("env_groups")
		envGroups.ListRule = types.Pointer("@request.auth.id != ''")
		envGroups.ViewRule = types.Pointer("@request.auth.id != ''")
		envGroups.CreateRule = nil
		envGroups.UpdateRule = nil
		envGroups.DeleteRule = nil

		envGroups.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      200,
		})
		envGroups.Fields.Add(&core.TextField{
			Name: "description",
		})
		envGroups.AddIndex("idx_env_groups_name", true, "name", "")

		if err := app.Save(envGroups); err != nil {
			return err
		}

		// ─── 3. env_group_vars ───────────────────────────────
		envGroupVars := core.NewBaseCollection("env_group_vars")
		envGroupVars.ListRule = types.Pointer("@request.auth.id != ''")
		envGroupVars.ViewRule = types.Pointer("@request.auth.id != ''")
		envGroupVars.CreateRule = nil
		envGroupVars.UpdateRule = nil
		envGroupVars.DeleteRule = nil

		envGroupVars.Fields.Add(&core.RelationField{
			Name:         "group",
			CollectionId: envGroups.Id,
			Required:     true,
			MaxSelect:    1,
		})
		envGroupVars.Fields.Add(&core.TextField{
			Name:     "key",
			Required: true,
			Max:      200,
		})
		envGroupVars.Fields.Add(&core.TextField{
			Name: "value",
		})
		envGroupVars.Fields.Add(&core.BoolField{
			Name: "is_secret",
		})
		envGroupVars.Fields.Add(&core.RelationField{
			Name:         "secret",
			CollectionId: secrets.Id,
			MaxSelect:    1,
		})
		envGroupVars.AddIndex("idx_env_group_vars_group", false, "`group`", "")
		envGroupVars.AddIndex("idx_env_group_vars_group_key", true, "`group`, `key`", "")

		if err := app.Save(envGroupVars); err != nil {
			return err
		}

		// ─── 4. servers ──────────────────────────────────────
		servers := core.NewBaseCollection("servers")
		servers.ListRule = types.Pointer("@request.auth.id != ''")
		servers.ViewRule = types.Pointer("@request.auth.id != ''")
		servers.CreateRule = nil
		servers.UpdateRule = nil
		servers.DeleteRule = nil

		servers.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      200,
		})
		servers.Fields.Add(&core.TextField{
			Name:     "host",
			Required: true,
		})
		servers.Fields.Add(&core.NumberField{
			Name:    "port",
			OnlyInt: true,
			Min:     types.Pointer(1.0),
			Max:     types.Pointer(65535.0),
		})
		servers.Fields.Add(&core.TextField{
			Name:     "user",
			Required: true,
		})
		servers.Fields.Add(&core.SelectField{
			Name:      "auth_type",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"password", "key"},
		})
		servers.Fields.Add(&core.RelationField{
			Name:         "credential",
			CollectionId: secrets.Id,
			MaxSelect:    1,
		})
		servers.Fields.Add(&core.TextField{
			Name: "description",
		})
		servers.AddIndex("idx_servers_name", true, "name", "")

		if err := app.Save(servers); err != nil {
			return err
		}

		// ─── 5. databases ────────────────────────────────────
		databases := core.NewBaseCollection("databases")
		databases.ListRule = types.Pointer("@request.auth.id != ''")
		databases.ViewRule = types.Pointer("@request.auth.id != ''")
		databases.CreateRule = nil
		databases.UpdateRule = nil
		databases.DeleteRule = nil

		databases.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      200,
		})
		databases.Fields.Add(&core.SelectField{
			Name:      "type",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"mysql", "postgres", "redis", "mongodb"},
		})
		databases.Fields.Add(&core.TextField{
			Name: "host",
		})
		databases.Fields.Add(&core.NumberField{
			Name:    "port",
			OnlyInt: true,
			Min:     types.Pointer(1.0),
			Max:     types.Pointer(65535.0),
		})
		databases.Fields.Add(&core.TextField{
			Name: "db_name",
		})
		databases.Fields.Add(&core.TextField{
			Name: "user",
		})
		databases.Fields.Add(&core.RelationField{
			Name:         "password",
			CollectionId: secrets.Id,
			MaxSelect:    1,
		})
		databases.Fields.Add(&core.TextField{
			Name: "description",
		})
		databases.AddIndex("idx_databases_name", true, "name", "")

		if err := app.Save(databases); err != nil {
			return err
		}

		// ─── 6. cloud_accounts ───────────────────────────────
		cloudAccounts := core.NewBaseCollection("cloud_accounts")
		cloudAccounts.ListRule = types.Pointer("@request.auth.id != ''")
		cloudAccounts.ViewRule = types.Pointer("@request.auth.id != ''")
		cloudAccounts.CreateRule = nil
		cloudAccounts.UpdateRule = nil
		cloudAccounts.DeleteRule = nil

		cloudAccounts.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      200,
		})
		cloudAccounts.Fields.Add(&core.SelectField{
			Name:      "provider",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"aws", "aliyun", "azure", "gcp"},
		})
		cloudAccounts.Fields.Add(&core.TextField{
			Name: "access_key_id",
		})
		cloudAccounts.Fields.Add(&core.RelationField{
			Name:         "secret",
			CollectionId: secrets.Id,
			MaxSelect:    1,
		})
		cloudAccounts.Fields.Add(&core.TextField{
			Name: "region",
		})
		cloudAccounts.Fields.Add(&core.JSONField{
			Name:    "extra",
			MaxSize: 1 << 20, // 1MB
		})
		cloudAccounts.Fields.Add(&core.TextField{
			Name: "description",
		})
		cloudAccounts.AddIndex("idx_cloud_accounts_name", true, "name", "")

		if err := app.Save(cloudAccounts); err != nil {
			return err
		}

		// ─── 7. certificates ─────────────────────────────────
		certificates := core.NewBaseCollection("certificates")
		certificates.ListRule = types.Pointer("@request.auth.id != ''")
		certificates.ViewRule = types.Pointer("@request.auth.id != ''")
		certificates.CreateRule = nil
		certificates.UpdateRule = nil
		certificates.DeleteRule = nil

		certificates.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      200,
		})
		certificates.Fields.Add(&core.TextField{
			Name: "domain",
		})
		certificates.Fields.Add(&core.TextField{
			Name: "cert_pem",
		})
		certificates.Fields.Add(&core.RelationField{
			Name:         "key",
			CollectionId: secrets.Id,
			MaxSelect:    1,
		})
		certificates.Fields.Add(&core.DateField{
			Name: "expires_at",
		})
		certificates.Fields.Add(&core.BoolField{
			Name: "auto_renew",
		})
		certificates.Fields.Add(&core.TextField{
			Name: "description",
		})
		certificates.AddIndex("idx_certificates_name", true, "name", "")
		certificates.AddIndex("idx_certificates_domain", false, "domain", "")

		return app.Save(certificates)
	}, func(app core.App) error {
		// Down: delete collections in reverse dependency order
		for _, name := range []string{
			"certificates",
			"cloud_accounts",
			"databases",
			"servers",
			"env_group_vars",
			"env_groups",
			"secrets",
		} {
			col, err := app.FindCollectionByNameOrId(name)
			if err != nil {
				continue // already deleted
			}
			if err := app.Delete(col); err != nil {
				return err
			}
		}
		return nil
	})
}
