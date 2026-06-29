package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	"github.com/websoft9/appos/backend/infra/collections"
)

func init() {
	m.Register(func(app core.App) error {
		return ensureConnectorsCollection(app)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.Connectors)
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}

func ensureConnectorsCollection(app core.App) error {
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
	addFieldIfMissing(col, &core.SelectField{Name: "kind", Required: true, MaxSelect: 1, Values: []string{connectors.KindLLM, connectors.KindRESTAPI, connectors.KindWebhook, connectors.KindMCP, connectors.KindSMTP, connectors.KindDNS, connectors.KindRegistry, connectors.KindProxy}})
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

func addFieldIfMissing(col *core.Collection, field core.Field) {
	if col.Fields.GetByName(field.GetName()) == nil {
		col.Fields.Add(field)
	}
}

func removeFieldIfExists(col *core.Collection, fieldName string) {
	if col.Fields.GetByName(fieldName) != nil {
		col.Fields.RemoveByName(fieldName)
	}
}
