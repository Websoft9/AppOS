package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return err
		}

		field := col.Fields.GetByName("host")
		if field == nil {
			return nil
		}

		textField, ok := field.(*core.TextField)
		if !ok {
			return nil
		}

		textField.Required = false
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return nil
		}

		field := col.Fields.GetByName("host")
		if field == nil {
			return nil
		}

		textField, ok := field.(*core.TextField)
		if !ok {
			return nil
		}

		textField.Required = true
		return app.Save(col)
	})
}
