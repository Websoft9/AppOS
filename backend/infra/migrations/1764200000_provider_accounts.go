package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/resource/accounts"
	"github.com/websoft9/appos/backend/infra/collections"
)

func init() {
	m.Register(func(app core.App) error {
		return ensureProviderAccountsCollection(app)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.ProviderAccounts)
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}

func ensureProviderAccountsCollection(app core.App) error {
	secretsCol, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		return err
	}

	col, err := app.FindCollectionByNameOrId(collections.ProviderAccounts)
	if err != nil {
		col = core.NewBaseCollection(collections.ProviderAccounts)
	}

	col.ListRule = types.Pointer("@request.auth.id != ''")
	col.ViewRule = types.Pointer("@request.auth.id != ''")
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil

	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true, Max: 200})
	addFieldIfMissing(col, &core.SelectField{Name: "kind", Required: true, MaxSelect: 1, Values: accounts.AllowedKinds()})
	addFieldIfMissing(col, &core.TextField{Name: "template_id", Max: 120})
	ensureProviderAccountIdentifierField(col)
	addFieldIfMissing(col, &core.RelationField{Name: "credential", CollectionId: secretsCol.Id, MaxSelect: 1})
	addFieldIfMissing(col, &core.JSONField{Name: "config", MaxSize: 1 << 20})
	addFieldIfMissing(col, &core.TextField{Name: "description"})
	col.AddIndex("idx_provider_accounts_name", true, "name", "")
	col.AddIndex("idx_provider_accounts_kind_template", false, "kind, template_id", "")

	return app.Save(col)
}

func ensureProviderAccountIdentifierField(col *core.Collection) {
	if existing := col.Fields.GetByName("identifier"); existing != nil {
		if field, ok := existing.(*core.TextField); ok {
			field.Required = true
			field.Max = 200
		}
		return
	}
	col.Fields.Add(&core.TextField{Name: "identifier", Required: true, Max: 200})
}
