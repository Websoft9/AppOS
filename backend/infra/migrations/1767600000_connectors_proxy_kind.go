package migrations

import (
	"slices"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	"github.com/websoft9/appos/backend/infra/collections"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.Connectors)
		if err != nil {
			return nil
		}

		field, ok := col.Fields.GetByName("kind").(*core.SelectField)
		if !ok || field == nil {
			return nil
		}

		if !slices.Contains(field.Values, connectors.KindProxy) {
			field.Values = append(field.Values, connectors.KindProxy)
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.Connectors)
		if err != nil {
			return nil
		}

		field, ok := col.Fields.GetByName("kind").(*core.SelectField)
		if !ok || field == nil {
			return nil
		}

		field.Values = slices.DeleteFunc(field.Values, func(value string) bool {
			return value == connectors.KindProxy
		})

		return app.Save(col)
	})
}
