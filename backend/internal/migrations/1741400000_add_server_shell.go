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

		col.Fields.Add(&core.TextField{
			Name:     "shell",
			Required: false,
		})

		return app.Save(col)
	}, func(app core.App) error {
		// shell is additive; rollback is a no-op
		return nil
	})
}
