package migrations

import (
	"fmt"
	"slices"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	"github.com/websoft9/appos/backend/infra/collections"
)

func init() {
	m.Register(func(app core.App) error {
		if err := addConnectorHTTPGatewayKind(app); err != nil {
			return err
		}
		if err := removeInstanceHTTPGatewayKind(app); err != nil {
			return err
		}
		return migrateHTTPGatewayInstancesToConnectors(app)
	}, func(app core.App) error {
		if err := addInstanceHTTPGatewayKind(app); err != nil {
			return err
		}
		return removeConnectorHTTPGatewayKind(app)
	})
}

func addConnectorHTTPGatewayKind(app core.App) error {
	col, err := app.FindCollectionByNameOrId(collections.Connectors)
	if err != nil {
		return nil
	}
	field, ok := col.Fields.GetByName("kind").(*core.SelectField)
	if !ok || field == nil {
		return nil
	}
	if !slices.Contains(field.Values, connectors.KindHTTPGateway) {
		field.Values = append(field.Values, connectors.KindHTTPGateway)
	}
	return app.Save(col)
}

func removeConnectorHTTPGatewayKind(app core.App) error {
	col, err := app.FindCollectionByNameOrId(collections.Connectors)
	if err != nil {
		return nil
	}
	field, ok := col.Fields.GetByName("kind").(*core.SelectField)
	if !ok || field == nil {
		return nil
	}
	field.Values = slices.DeleteFunc(field.Values, func(value string) bool {
		return value == connectors.KindHTTPGateway
	})
	return app.Save(col)
}

func addInstanceHTTPGatewayKind(app core.App) error {
	col, err := app.FindCollectionByNameOrId(collections.Instances)
	if err != nil {
		return nil
	}
	field, ok := col.Fields.GetByName("kind").(*core.SelectField)
	if !ok || field == nil {
		return nil
	}
	if !slices.Contains(field.Values, "http-gateway") {
		field.Values = append(field.Values, "http-gateway")
	}
	return app.Save(col)
}

func removeInstanceHTTPGatewayKind(app core.App) error {
	col, err := app.FindCollectionByNameOrId(collections.Instances)
	if err != nil {
		return nil
	}
	field, ok := col.Fields.GetByName("kind").(*core.SelectField)
	if !ok || field == nil {
		return nil
	}
	field.Values = slices.DeleteFunc(field.Values, func(value string) bool {
		return value == "http-gateway"
	})
	return app.Save(col)
}

func migrateHTTPGatewayInstancesToConnectors(app core.App) error {
	instanceCol, err := app.FindCollectionByNameOrId(collections.Instances)
	if err != nil {
		return nil
	}
	connectorCol, err := app.FindCollectionByNameOrId(collections.Connectors)
	if err != nil {
		return err
	}
	records, err := app.FindRecordsByFilter(
		instanceCol,
		"kind = {:kind}",
		"",
		0,
		0,
		dbx.Params{"kind": "http-gateway"},
	)
	if err != nil {
		return err
	}
	for _, record := range records {
		name := record.GetString("name")
		existing, err := app.FindFirstRecordByFilter(
			connectorCol,
			"name = {:name}",
			dbx.Params{"name": name},
		)
		if err == nil && existing != nil {
			continue
		}
		connector := core.NewRecord(connectorCol)
		connector.Set("name", name)
		connector.Set("kind", connectors.KindHTTPGateway)
		templateID := record.GetString("template_id")
		if templateID == "" {
			templateID = "generic-http-gateway"
		}
		connector.Set("template_id", templateID)
		connector.Set("endpoint", record.GetString("endpoint"))
		connector.Set("auth_scheme", connectors.AuthSchemeBearer)
		connector.Set("provider_account", record.GetString("provider_account"))
		connector.Set("credential", record.GetString("credential"))
		connector.Set("config", record.Get("config"))
		connector.Set("description", record.GetString("description"))
		connector.Set("is_default", false)
		if err := app.Save(connector); err != nil {
			return fmt.Errorf("migrate http gateway instance %q: %w", name, err)
		}
		if err := app.Delete(record); err != nil {
			return fmt.Errorf("delete migrated http gateway instance %q: %w", name, err)
		}
	}
	return nil
}