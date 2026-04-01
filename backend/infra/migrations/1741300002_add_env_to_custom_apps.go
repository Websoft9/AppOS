package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("store_custom_apps")
		if err != nil {
			return err
		}

		col.Fields.Add(&core.TextField{
			Name:     "env_text",
			Required: false,
		})

		return app.Save(col)
	}, func(app core.App) error {
		// env_text is optional and additive; rollback is a no-op
		return nil
	})
}
