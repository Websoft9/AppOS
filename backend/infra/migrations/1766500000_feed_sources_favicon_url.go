package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_sources")
		if err != nil {
			return err
		}

		if col.Fields.GetByName("favicon_url") == nil {
			col.Fields.Add(&core.URLField{Name: "favicon_url"})
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_sources")
		if err != nil {
			return err
		}

		col.Fields.RemoveByName("favicon_url")
		return app.Save(col)
	})
}