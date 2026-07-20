package schema

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
	secretdomain "github.com/websoft9/appos/backend/domain/secrets"
)

func EnsureSecretsCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		col = core.NewBaseCollection("secrets")
	}

	anyAuthOrOwner := "@request.auth.id != '' && (scope = 'global' || created_by = @request.auth.id || @request.auth.collectionName = '_superusers')"
	anyAuth := "@request.auth.id != ''"
	superOnly := "@request.auth.collectionName = '_superusers'"
	col.ListRule = &anyAuthOrOwner
	col.ViewRule = &anyAuthOrOwner
	col.CreateRule = &anyAuth
	col.UpdateRule = &anyAuthOrOwner
	col.DeleteRule = &superOnly

	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true, Max: 200})
	addFieldIfMissing(col, &core.SelectField{Name: "type", MaxSelect: 1, Values: []string{"password", "api_key", "token", "ssh_key", "tunnel_token"}})
	addFieldIfMissing(col, &core.TextField{Name: "value", Hidden: true})
	addFieldIfMissing(col, &core.TextField{Name: "description", Max: 500})
	addFieldIfMissing(col, &core.TextField{Name: "template_id", Max: 120})
	addFieldIfMissing(col, &core.SelectField{Name: "visible_to", Values: append([]string(nil), secretdomain.VisibleToValues...), MaxSelect: len(secretdomain.VisibleToValues)})
	addFieldIfMissing(col, &core.SelectField{Name: "scope", MaxSelect: 1, Values: []string{"global", "user_private"}})
	addFieldIfMissing(col, &core.SelectField{Name: "access_mode", MaxSelect: 1, Values: []string{"use_only", "reveal_once", "reveal_allowed"}})
	addFieldIfMissing(col, &core.JSONField{Name: "payload", Hidden: true})
	addFieldIfMissing(col, &core.TextField{Name: "payload_encrypted", Hidden: true})
	addFieldIfMissing(col, &core.JSONField{Name: "payload_meta"})
	addFieldIfMissing(col, &core.SelectField{Name: "status", MaxSelect: 1, Values: []string{"active", "revoked"}})
	addFieldIfMissing(col, &core.NumberField{Name: "version", OnlyInt: true, Min: types.Pointer(1.0)})
	addFieldIfMissing(col, &core.SelectField{Name: "created_source", Values: []string{"user", "system"}})
	addFieldIfMissing(col, &core.DateField{Name: "last_used_at"})
	addFieldIfMissing(col, &core.TextField{Name: "expires_at"})
	addFieldIfMissing(col, &core.TextField{Name: "last_used_by", Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "created_by", Max: 100})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_secrets_name", true, "name", "")
	col.AddIndex("idx_secrets_created_by", false, "created_by", "")
	col.AddIndex("idx_secrets_template_id", false, "template_id", "")
	return app.Save(col)
}
