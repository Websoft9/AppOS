package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return err
		}

		ensureTextField(col, "description", false, false, 500)
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return nil
		}

		dropField(col, "description")
		return app.Save(col)
	})
}
