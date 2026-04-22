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

		if col.Fields.GetByName("created_by") == nil {
			col.Fields.Add(&core.TextField{Name: "created_by"})
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return nil
		}

		field := col.Fields.GetByName("created_by")
		if field != nil {
			col.Fields.RemoveById(field.GetId())
		}

		return app.Save(col)
	})
}