package migrations

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_items")
		if err != nil {
			return fmt.Errorf("find feed_items collection: %w", err)
		}

		if col.Fields.GetByName("favicon_url") == nil {
			col.Fields.Add(&core.URLField{Name: "favicon_url"})
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_items")
		if err != nil {
			return err
		}

		col.Fields.RemoveByName("favicon_url")
		if err := app.Save(col); err != nil {
			return err
		}

		if _, err := app.DB().NewQuery("PRAGMA table_info(`feed_items`)").Execute(); err != nil && !strings.Contains(strings.ToLower(err.Error()), "table_info") {
			return err
		}
		return nil
	})
}