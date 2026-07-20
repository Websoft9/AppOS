package schema

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

func EnsureFeedSourcesCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId("feed_sources")
	if err != nil {
		col = core.NewBaseCollection("feed_sources")
	}
	superuserRule := types.Pointer("@request.auth.collectionName = '_superusers'")
	col.ListRule = authenticatedRule()
	col.ViewRule = authenticatedRule()
	col.CreateRule = superuserRule
	col.UpdateRule = superuserRule
	col.DeleteRule = superuserRule
	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "url", Required: true})
	addFieldIfMissing(col, &core.SelectField{Name: "format", Required: true, MaxSelect: 1, Values: []string{"rss", "atom"}})
	addFieldIfMissing(col, &core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"active", "paused", "archived"}})
	addFieldIfMissing(col, &core.NumberField{Name: "failure_streak", OnlyInt: true, Min: types.Pointer(0.0), Max: types.Pointer(2147483647.0)})
	addFieldIfMissing(col, &core.DateField{Name: "next_poll_at"})
	addFieldIfMissing(col, &core.NumberField{Name: "item_count", OnlyInt: true})
	addFieldIfMissing(col, &core.URLField{Name: "favicon_url"})
	addFieldIfMissing(col, &core.DateField{Name: "last_fetched_at"})
	addFieldIfMissing(col, &core.DateField{Name: "last_success_at"})
	addFieldIfMissing(col, &core.TextField{Name: "last_error", Max: 1000})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_feed_sources_url", true, "url", "")
	return app.Save(col)
}
