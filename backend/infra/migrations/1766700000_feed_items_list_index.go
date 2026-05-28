package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Add a composite index on feed_items(origin_type, published_at DESC, created DESC) to
// eliminate full-table scans and B-tree file-sorts from the paginated list query.
func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_items")
		if err != nil {
			return err
		}
		col.Indexes = append(
			col.Indexes,
			"CREATE INDEX idx_feed_items_list ON feed_items (origin_type, published_at DESC, created DESC)",
		)
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_items")
		if err != nil {
			return err
		}
		filtered := col.Indexes[:0]
		for _, idx := range col.Indexes {
			if idx != "CREATE INDEX idx_feed_items_list ON feed_items (origin_type, published_at DESC, created DESC)" {
				filtered = append(filtered, idx)
			}
		}
		col.Indexes = filtered
		return app.Save(col)
	})
}
