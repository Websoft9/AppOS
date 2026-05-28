package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_sources")
		if err != nil {
			return err
		}

		if col.Fields.GetByName("item_count") == nil {
			col.Fields.Add(&core.NumberField{Name: "item_count", OnlyInt: true})
		}
		if err := app.Save(col); err != nil {
			return err
		}

		_, err = app.DB().NewQuery(`
			UPDATE feed_sources
			SET item_count = COALESCE((
				SELECT COUNT(*)
				FROM feed_items
				WHERE origin_type = {:origin_type}
				  AND source_id = feed_sources.id
			), 0)`,
		).Bind(dbx.Params{"origin_type": "feed"}).Execute()
		return err
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_sources")
		if err != nil {
			return err
		}

		col.Fields.RemoveByName("item_count")
		return app.Save(col)
	})
}