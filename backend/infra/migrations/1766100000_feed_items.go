package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Story 27.2: Create the `feed_items` collection for normalized feed entries.
func init() {
	m.Register(func(app core.App) error {
		sourcesCol, err := app.FindCollectionByNameOrId("feed_sources")
		if err != nil {
			return err
		}

		col := core.NewBaseCollection("feed_items")
		col.ListRule = types.Pointer("@request.auth.id != ''")
		col.ViewRule = types.Pointer("@request.auth.id != ''")
		col.CreateRule = nil
		col.UpdateRule = nil
		col.DeleteRule = nil

		col.Fields.Add(&core.RelationField{
			Name:          "source_id",
			CollectionId:  sourcesCol.Id,
			Required:      false,
			CascadeDelete: true,
			MaxSelect:     1,
		})
		col.Fields.Add(&core.SelectField{Name: "origin_type", Required: true, MaxSelect: 1, Values: []string{"feed", "bookmark"}})
		col.Fields.Add(&core.TextField{Name: "external_id", Required: true})
		col.Fields.Add(&core.TextField{Name: "title", Required: true, Max: 500})
		col.Fields.Add(&core.TextField{Name: "link", Required: true})
		col.Fields.Add(&core.DateField{Name: "published_at"})
		col.Fields.Add(&core.TextField{Name: "summary"})
		col.Fields.Add(&core.URLField{Name: "favicon_url"})
		col.Fields.Add(&core.JSONField{Name: "keywords_json"})
		col.Fields.Add(&core.JSONField{Name: "tags_json"})
		col.Fields.Add(&core.SelectField{Name: "read_state", Required: true, MaxSelect: 1, Values: []string{"unread", "read"}})
		col.Fields.Add(&core.BoolField{Name: "is_starred"})
		col.Fields.Add(&core.TextField{Name: "content_raw", Max: 1 << 20})
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		col.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

		col.Indexes = append(col.Indexes,
			"CREATE UNIQUE INDEX idx_feed_items_source_external_id ON feed_items (source_id, external_id)",
			"CREATE INDEX idx_feed_items_list ON feed_items (origin_type, published_at DESC, created DESC)",
		)

		if err := app.Save(col); err != nil {
			return err
		}

		statements := []string{
			"DROP TABLE IF EXISTS feed_items__rebuilt",
			"CREATE TABLE feed_items__rebuilt (`created` TEXT DEFAULT '' NOT NULL, `external_id` TEXT DEFAULT '' NOT NULL, `id` TEXT PRIMARY KEY DEFAULT ('r'||lower(hex(randomblob(7)))) NOT NULL, `keywords_json` JSON DEFAULT NULL, `link` TEXT DEFAULT '' NOT NULL, `published_at` TEXT DEFAULT '' NOT NULL, `source_id` TEXT DEFAULT NULL, `summary` TEXT DEFAULT '' NOT NULL, `tags_json` JSON DEFAULT NULL, `title` TEXT DEFAULT '' NOT NULL, `updated` TEXT DEFAULT '' NOT NULL, `origin_type` TEXT DEFAULT 'feed' NOT NULL, `read_state` TEXT DEFAULT '' NOT NULL, `is_starred` BOOLEAN DEFAULT FALSE NOT NULL, `favicon_url` TEXT DEFAULT '' NOT NULL, `content_raw` TEXT DEFAULT '' NOT NULL)",
			"INSERT INTO feed_items__rebuilt (`created`, `external_id`, `id`, `keywords_json`, `link`, `published_at`, `source_id`, `summary`, `tags_json`, `title`, `updated`, `origin_type`, `read_state`, `is_starred`, `favicon_url`, `content_raw`) SELECT `created`, `external_id`, `id`, `keywords_json`, `link`, `published_at`, `source_id`, `summary`, `tags_json`, `title`, `updated`, CASE WHEN COALESCE(`origin_type`, '') = '' THEN 'feed' ELSE `origin_type` END, `read_state`, COALESCE(`is_starred`, FALSE), COALESCE(`favicon_url`, ''), COALESCE(`content_raw`, '') FROM feed_items",
			"DROP TABLE feed_items",
			"ALTER TABLE feed_items__rebuilt RENAME TO feed_items",
			"CREATE UNIQUE INDEX idx_feed_items_source_external_id ON feed_items (source_id, external_id)",
			"CREATE INDEX idx_feed_items_list ON feed_items (origin_type, published_at DESC, created DESC)",
		}

		for _, statement := range statements {
			if _, err := app.DB().NewQuery(statement).Execute(); err != nil {
				return fmt.Errorf("finalize feed_items base schema: %w", err)
			}
		}

		return nil
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_items")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}