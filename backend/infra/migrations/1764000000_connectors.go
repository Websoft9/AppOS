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
		if err := ensureConnectorsCollection(app); err != nil {
			return err
		}
		if err := rewriteGroupItemObjectType(app, "endpoint", "connector"); err != nil {
			return err
		}
		return rewriteConnectorTemplateID(app, "custom-llm", "generic-llm")
	}, func(app core.App) error {
		if err := rewriteGroupItemObjectType(app, "connector", "endpoint"); err != nil {
			return err
		}
		if err := ensureLegacyEndpointsCollection(app); err != nil {
			return err
		}
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
	addFieldIfMissing(col, &core.SelectField{Name: "kind", Required: true, MaxSelect: 1, Values: []string{connectors.KindLLM, connectors.KindRESTAPI, connectors.KindWebhook, connectors.KindMCP, connectors.KindSMTP, connectors.KindDNS, connectors.KindRegistry}})
	addFieldIfMissing(col, &core.BoolField{Name: "is_default"})
	addFieldIfMissing(col, &core.TextField{Name: "template_id", Max: 120})
	addFieldIfMissing(col, &core.TextField{Name: "endpoint"})
	addFieldIfMissing(col, &core.SelectField{Name: "auth_scheme", MaxSelect: 1, Values: []string{connectors.AuthSchemeNone, connectors.AuthSchemeAPIKey, connectors.AuthSchemeBearer, connectors.AuthSchemeBasic}})
	addFieldIfMissing(col, &core.RelationField{Name: "credential", CollectionId: secretsCol.Id, MaxSelect: 1})
	addFieldIfMissing(col, &core.JSONField{Name: "config", MaxSize: 1 << 20})
	addFieldIfMissing(col, &core.TextField{Name: "description"})
	col.AddIndex("idx_connectors_name", true, "name", "")
	col.AddIndex("idx_connectors_kind_template", false, "kind, template_id", "")

	return app.Save(col)
}

func ensureLegacyEndpointsCollection(app core.App) error {
	secretsCol, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		return err
	}

	if _, err := app.FindCollectionByNameOrId("endpoints"); err == nil {
		return nil
	}

	col := core.NewBaseCollection("endpoints")
	col.ListRule = types.Pointer("@request.auth.id != ''")
	col.ViewRule = types.Pointer("@request.auth.id != ''")
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil

	col.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 200})
	col.Fields.Add(&core.SelectField{Name: "type", Required: true, MaxSelect: 1, Values: []string{"rest", "webhook", "mcp"}})
	col.Fields.Add(&core.TextField{Name: "url", Required: true})
	col.Fields.Add(&core.SelectField{Name: "auth_type", Required: true, MaxSelect: 1, Values: []string{"none", "api_key", "bearer", "basic"}})
	col.Fields.Add(&core.RelationField{Name: "credential", CollectionId: secretsCol.Id, MaxSelect: 1})
	col.Fields.Add(&core.JSONField{Name: "extra", MaxSize: 1 << 20})
	col.Fields.Add(&core.TextField{Name: "description"})
	col.AddIndex("idx_endpoints_name", true, "name", "")

	return app.Save(col)
}

func rewriteGroupItemObjectType(app core.App, fromType, toType string) error {
	items, err := app.FindRecordsByFilter("group_items", "object_type = {:type}", "", 0, 0, map[string]any{"type": fromType})
	if err != nil {
		return nil
	}
	for _, item := range items {
		item.Set("object_type", toType)
		if err := app.Save(item); err != nil {
			return err
		}
	}
	return nil
}

func rewriteConnectorTemplateID(app core.App, fromID, toID string) error {
	items, err := app.FindRecordsByFilter("connectors", "template_id = {:template_id}", "", 0, 0, map[string]any{"template_id": fromID})
	if err != nil {
		return nil
	}
	for _, item := range items {
		item.Set("template_id", toID)
		if err := app.Save(item); err != nil {
			return err
		}
	}
	return nil
}

func addFieldIfMissing(col *core.Collection, field core.Field) {
	if col.Fields.GetByName(field.GetName()) == nil {
		col.Fields.Add(field)
	}
}
