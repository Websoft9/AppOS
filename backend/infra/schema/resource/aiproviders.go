package resource

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/resource/aiproviders"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	"github.com/websoft9/appos/backend/infra/collections"
)

func EnsureAIProvidersCollection(app core.App) error {
	secretsCol, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		return err
	}
	accountsCol, err := app.FindCollectionByNameOrId(collections.ProviderAccounts)
	if err != nil {
		return err
	}

	col, err := app.FindCollectionByNameOrId(collections.AIProviders)
	if err != nil {
		col = core.NewBaseCollection(collections.AIProviders)
	}

	col.ListRule = types.Pointer("@request.auth.id != ''")
	col.ViewRule = types.Pointer("@request.auth.id != ''")
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil

	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true, Max: 200})
	addFieldIfMissing(col, &core.SelectField{Name: "kind", Required: true, MaxSelect: 1, Values: []string{aiproviders.KindLLM}})
	addFieldIfMissing(col, &core.BoolField{Name: "is_enabled"})
	addFieldIfMissing(col, &core.BoolField{Name: "is_default"})
	addFieldIfMissing(col, &core.TextField{Name: "template_id", Max: 120})
	addFieldIfMissing(col, &core.TextField{Name: "endpoint"})
	addFieldIfMissing(col, &core.SelectField{Name: "auth_scheme", MaxSelect: 1, Values: []string{connectors.AuthSchemeNone, connectors.AuthSchemeAPIKey, connectors.AuthSchemeBearer, connectors.AuthSchemeBasic}})
	addFieldIfMissing(col, &core.RelationField{Name: "provider_account", CollectionId: accountsCol.Id, MaxSelect: 1})
	addFieldIfMissing(col, &core.RelationField{Name: "credential", CollectionId: secretsCol.Id, MaxSelect: 1})
	addFieldIfMissing(col, &core.JSONField{Name: "config", MaxSize: 1 << 20})
	addFieldIfMissing(col, &core.TextField{Name: "description"})
	col.AddIndex("idx_ai_providers_name", true, "name", "")
	col.AddIndex("idx_ai_providers_kind_template", false, "kind, template_id", "")

	return app.Save(col)
}
