package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Secrets domain — single migration file for the secrets collection schema.
func init() {
	m.Register(func(app core.App) error {
		secrets := core.NewBaseCollection("secrets")

		anyAuthOrOwner := "@request.auth.id != '' && (scope = 'global' || created_by = @request.auth.id || @request.auth.collectionName = '_superusers')"
		anyAuth := "@request.auth.id != ''"
		superOnly := "@request.auth.collectionName = '_superusers'"

		secrets.ListRule = &anyAuthOrOwner
		secrets.ViewRule = &anyAuthOrOwner
		secrets.CreateRule = &anyAuth
		secrets.UpdateRule = &anyAuthOrOwner
		secrets.DeleteRule = &superOnly

		secrets.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 200})
		secrets.Fields.Add(&core.SelectField{Name: "type", MaxSelect: 1, Values: []string{"password", "api_key", "token", "ssh_key", "tunnel_token"}})
		secrets.Fields.Add(&core.TextField{Name: "value", Hidden: true})
		secrets.Fields.Add(&core.TextField{Name: "description", Max: 500})
		secrets.Fields.Add(&core.TextField{Name: "template_id", Max: 120})
		secrets.Fields.Add(&core.SelectField{Name: "scope", MaxSelect: 1, Values: []string{"global", "user_private"}})
		secrets.Fields.Add(&core.SelectField{Name: "access_mode", MaxSelect: 1, Values: []string{"use_only", "reveal_once", "reveal_allowed"}})
		secrets.Fields.Add(&core.JSONField{Name: "payload", Hidden: true})
		secrets.Fields.Add(&core.TextField{Name: "payload_encrypted", Hidden: true})
		secrets.Fields.Add(&core.JSONField{Name: "payload_meta"})
		secrets.Fields.Add(&core.SelectField{Name: "status", MaxSelect: 1, Values: []string{"active", "revoked"}})
		secrets.Fields.Add(&core.NumberField{Name: "version", OnlyInt: true, Min: types.Pointer(1.0)})
		secrets.Fields.Add(&core.SelectField{Name: "created_source", Values: []string{"user", "system"}})
		secrets.Fields.Add(&core.DateField{Name: "last_used_at"})
		secrets.Fields.Add(&core.TextField{Name: "expires_at"})
		secrets.Fields.Add(&core.TextField{Name: "last_used_by", Max: 200})
		secrets.Fields.Add(&core.TextField{Name: "created_by", Max: 100})
		secrets.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		secrets.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

		secrets.AddIndex("idx_secrets_name", true, "name", "")
		secrets.AddIndex("idx_secrets_created_by", false, "created_by", "")
		secrets.AddIndex("idx_secrets_template_id", false, "template_id", "")

		return app.Save(secrets)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}
