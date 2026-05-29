package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/domain/assets"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(assets.Collection)
		if err != nil {
			return err
		}

		if col.Fields.GetByName("description") == nil {
			col.Fields.Add(&core.TextField{Name: "description", Max: 4000})
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(assets.Collection)
		if err != nil {
			return nil
		}
		col.Fields.RemoveByName("description")
		return app.Save(col)
	})
}