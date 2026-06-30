package resource

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	"github.com/websoft9/appos/backend/infra/collections"
)

func EnsureConnectorsCollection(app core.App) error {
	secretsCol, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		return err
	}
	providerAccountsCol, providerAccountsErr := app.FindCollectionByNameOrId(collections.ProviderAccounts)

	col, err := app.FindCollectionByNameOrId(collections.Connectors)
	if err != nil {
		col = core.NewBaseCollection(collections.Connectors)
	}

	col.ListRule = types.Pointer("@request.auth.id != ''")
	col.ViewRule = types.Pointer("@request.auth.id != ''")
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil

	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true, Max: 200})
	addFieldIfMissing(col, &core.SelectField{Name: "kind", Required: true, MaxSelect: 1, Values: connectors.AllowedKinds()})
	addFieldIfMissing(col, &core.BoolField{Name: "is_enabled"})
	removeFieldIfExists(col, "is_default")
	addFieldIfMissing(col, &core.TextField{Name: "template_id", Max: 120})
	addFieldIfMissing(col, &core.TextField{Name: "endpoint"})
	addFieldIfMissing(col, &core.SelectField{Name: "auth_scheme", MaxSelect: 1, Values: []string{connectors.AuthSchemeNone, connectors.AuthSchemeAPIKey, connectors.AuthSchemeBearer, connectors.AuthSchemeBasic}})
	if providerAccountsErr == nil {
		addFieldIfMissing(col, &core.RelationField{Name: "provider_account", CollectionId: providerAccountsCol.Id, MaxSelect: 1})
	}
	addFieldIfMissing(col, &core.RelationField{Name: "credential", CollectionId: secretsCol.Id, MaxSelect: 1})
	addFieldIfMissing(col, &core.JSONField{Name: "config", MaxSize: 1 << 20})
	addFieldIfMissing(col, &core.TextField{Name: "description"})
	col.AddIndex("idx_connectors_name", true, "name", "")
	col.AddIndex("idx_connectors_kind_template", false, "kind, template_id", "")

	return app.Save(col)
}
