package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/resource/aiproviders"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	"github.com/websoft9/appos/backend/infra/collections"
)

func init() {
	m.Register(func(app core.App) error {
		if err := ensureAIProvidersCollection(app); err != nil {
			return err
		}
		if err := backfillAIProvidersFromConnectors(app); err != nil {
			return err
		}
		if err := rewriteAIProviderGroupItems(app, "connector", "ai_provider"); err != nil {
			return err
		}
		return deleteLLMConnectors(app)
	}, func(app core.App) error {
		if err := ensureConnectorsCollection(app); err != nil {
			return err
		}
		if err := backfillConnectorsFromAIProviders(app); err != nil {
			return err
		}
		if err := rewriteAIProviderGroupItems(app, "ai_provider", "connector"); err != nil {
			return err
		}
		col, err := app.FindCollectionByNameOrId(collections.AIProviders)
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}

func ensureAIProvidersCollection(app core.App) error {
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

func backfillAIProvidersFromConnectors(app core.App) error {
	connectorsCol, err := app.FindCollectionByNameOrId(collections.Connectors)
	if err != nil {
		return nil
	}
	aiProvidersCol, err := app.FindCollectionByNameOrId(collections.AIProviders)
	if err != nil {
		return err
	}
	records, err := app.FindRecordsByFilter(connectorsCol, "kind = {:kind}", "", 0, 0, map[string]any{"kind": connectors.KindLLM})
	if err != nil {
		return nil
	}
	for _, record := range records {
		copied, err := app.FindRecordById(collections.AIProviders, record.Id)
		if err != nil {
			copied = core.NewRecord(aiProvidersCol)
			copied.Set("id", record.Id)
		}
		copyResourceRecordFields(copied, record)
		if err := app.Save(copied); err != nil {
			return err
		}
	}
	return nil
}

func backfillConnectorsFromAIProviders(app core.App) error {
	aiProvidersCol, err := app.FindCollectionByNameOrId(collections.AIProviders)
	if err != nil {
		return nil
	}
	connectorsCol, err := app.FindCollectionByNameOrId(collections.Connectors)
	if err != nil {
		return err
	}
	records, err := app.FindRecordsByFilter(aiProvidersCol, "", "", 0, 0, nil)
	if err != nil {
		return nil
	}
	for _, record := range records {
		copied, err := app.FindRecordById(collections.Connectors, record.Id)
		if err != nil {
			copied = core.NewRecord(connectorsCol)
			copied.Set("id", record.Id)
		}
		copyResourceRecordFields(copied, record)
		if err := app.Save(copied); err != nil {
			return err
		}
	}
	return nil
}

func rewriteAIProviderGroupItems(app core.App, fromType, toType string) error {
	items, err := app.FindRecordsByFilter("group_items", "object_type = {:type}", "", 0, 0, map[string]any{"type": fromType})
	if err != nil {
		return nil
	}
	for _, item := range items {
		objectID := item.GetString("object_id")
		if objectID == "" {
			continue
		}
		record, lookupErr := app.FindRecordById(collections.AIProviders, objectID)
		if toType == "connector" {
			record, lookupErr = app.FindRecordById(collections.Connectors, objectID)
		}
		if lookupErr != nil || record == nil {
			continue
		}
		item.Set("object_type", toType)
		if err := app.Save(item); err != nil {
			return err
		}
	}
	return nil
}

func deleteLLMConnectors(app core.App) error {
	records, err := app.FindRecordsByFilter(collections.Connectors, "kind = {:kind}", "", 0, 0, map[string]any{"kind": connectors.KindLLM})
	if err != nil {
		return nil
	}
	for _, record := range records {
		if err := app.Delete(record); err != nil {
			return err
		}
	}
	return nil
}

func copyResourceRecordFields(dst *core.Record, src *core.Record) {
	for _, field := range []string{"name", "kind", "is_default", "template_id", "endpoint", "auth_scheme", "provider_account", "credential", "config", "description"} {
		dst.Set(field, src.Get(field))
	}
}
