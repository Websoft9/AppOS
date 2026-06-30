package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/infra/collections"
	resourceschema "github.com/websoft9/appos/backend/infra/schema/resource"
)

func init() {
	m.Register(func(app core.App) error {
		return resourceschema.EnsureConnectorsCollection(app)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.Connectors)
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
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
