package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Story 27.1: Create the `feed_sources` collection for Feeds source registry.
func init() {
	m.Register(func(app core.App) error {
		col := core.NewBaseCollection("feed_sources")

		col.ListRule = types.Pointer("@request.auth.id != ''")
		col.ViewRule = types.Pointer("@request.auth.id != ''")
		col.CreateRule = types.Pointer("@request.auth.collectionName = '_superusers'")
		col.UpdateRule = types.Pointer("@request.auth.collectionName = '_superusers'")
		col.DeleteRule = types.Pointer("@request.auth.collectionName = '_superusers'")

		col.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 200})
		col.Fields.Add(&core.TextField{Name: "url", Required: true})
		col.Fields.Add(&core.SelectField{Name: "format", Required: true, MaxSelect: 1, Values: []string{"rss", "atom"}})
		col.Fields.Add(&core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"active", "paused", "archived"}})
		col.Fields.Add(&core.NumberField{Name: "failure_streak", OnlyInt: true, Min: types.Pointer(0.0), Max: types.Pointer(2147483647.0)})
		col.Fields.Add(&core.DateField{Name: "next_poll_at"})
		col.Fields.Add(&core.NumberField{Name: "item_count", OnlyInt: true})
		col.Fields.Add(&core.URLField{Name: "favicon_url"})
		col.Fields.Add(&core.DateField{Name: "last_fetched_at"})
		col.Fields.Add(&core.DateField{Name: "last_success_at"})
		col.Fields.Add(&core.TextField{Name: "last_error", Max: 1000})
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		col.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

		col.Indexes = append(col.Indexes,
			"CREATE UNIQUE INDEX idx_feed_sources_url ON feed_sources (url)",
		)

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_sources")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}
