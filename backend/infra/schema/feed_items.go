package schema

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/feeds"
)

func EnsureFeedItemsCollection(app core.App) error {
	sourcesCol, err := app.FindCollectionByNameOrId("feed_sources")
	if err != nil {
		return err
	}
	col, err := app.FindCollectionByNameOrId("feed_items")
	if err != nil {
		col = core.NewBaseCollection("feed_items")
	}
	col.ListRule = authenticatedRule()
	col.ViewRule = authenticatedRule()
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.RelationField{Name: "source_id", CollectionId: sourcesCol.Id, CascadeDelete: true, MaxSelect: 1})
	addFieldIfMissing(col, &core.SelectField{Name: "origin_type", Required: true, MaxSelect: 1, Values: []string{"feed", "bookmark"}})
	addFieldIfMissing(col, &core.TextField{Name: "external_id", Required: true})
	addFieldIfMissing(col, &core.TextField{Name: "title", Required: true, Max: 500})
	addFieldIfMissing(col, &core.TextField{Name: "link", Required: true})
	addFieldIfMissing(col, &core.DateField{Name: "published_at"})
	addFieldIfMissing(col, &core.TextField{Name: "summary"})
	addFieldIfMissing(col, &core.URLField{Name: "favicon_url"})
	addFieldIfMissing(col, &core.JSONField{Name: "keywords_json"})
	addFieldIfMissing(col, &core.JSONField{Name: "tags_json"})
	addFieldIfMissing(col, &core.SelectField{Name: "read_state", Required: true, MaxSelect: 1, Values: []string{"unread", "read"}})
	addFieldIfMissing(col, &core.BoolField{Name: "is_starred"})
	addFieldIfMissing(col, &core.TextField{Name: "content_raw", Max: 1 << 20})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_feed_items_source_external_id", true, "source_id, external_id", "")
	col.AddIndex("idx_feed_items_list", false, "origin_type, published_at, created", "")
	if err := app.Save(col); err != nil {
		return err
	}
	return ensureFeedItemsOriginTypeDefault(app)
}

func ensureFeedItemsOriginTypeDefault(app core.App) error {
	type sqliteColumnDefault struct {
		Name      string `db:"name"`
		DfltValue string `db:"dflt_value"`
	}

	var columns []sqliteColumnDefault
	if err := app.DB().NewQuery("PRAGMA table_info(`feed_items`)").All(&columns); err != nil {
		return err
	}
	for _, column := range columns {
		if column.Name == "origin_type" && column.DfltValue == "'feed'" {
			return nil
		}
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

	_, err := app.FindCollectionByNameOrId(feeds.CollectionItems)
	return err
}
