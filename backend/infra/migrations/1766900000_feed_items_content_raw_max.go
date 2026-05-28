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

		field, ok := col.Fields.GetByName("content_raw").(*core.TextField)
		if !ok {
			return nil
		}

		field.Max = 1 << 20
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_items")
		if err != nil {
			return err
		}

		field, ok := col.Fields.GetByName("content_raw").(*core.TextField)
		if !ok {
			return nil
		}

		field.Max = 5000
		return app.Save(col)
	})
}