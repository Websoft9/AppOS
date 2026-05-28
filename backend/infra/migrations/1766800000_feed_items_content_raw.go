package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_items")
		if err != nil {
			return err
		}

		if col.Fields.GetByName("content_raw") == nil {
			col.Fields.Add(&core.TextField{Name: "content_raw", Max: 1 << 20})
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_items")
		if err != nil {
			return err
		}

		col.Fields.RemoveByName("content_raw")
		return app.Save(col)
	})
}