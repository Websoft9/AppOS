package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	secretdomain "github.com/websoft9/appos/backend/domain/secrets"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return err
		}

		field := col.Fields.GetByName("visible_to")
		if selectField, ok := field.(*core.SelectField); ok {
			selectField.Values = append([]string(nil), secretdomain.VisibleToValues...)
			selectField.MaxSelect = len(secretdomain.VisibleToValues)
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return nil
		}

		field := col.Fields.GetByName("visible_to")
		if selectField, ok := field.(*core.SelectField); ok {
			values := make([]string, 0, len(selectField.Values))
			for _, value := range selectField.Values {
				if value == secretdomain.VisibleToApplication {
					continue
				}
				values = append(values, value)
			}
			selectField.Values = values
			selectField.MaxSelect = len(values)
		}

		return app.Save(col)
	})
}