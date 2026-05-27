package migrations

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

type sqliteFeedItemsDefaultColumn struct {
	Name      string `db:"name"`
	DfltValue string `db:"dflt_value"`
}

// Story 27.x: backfill feed_items.origin_type and make the live SQLite default explicit.
func init() {
	m.Register(func(app core.App) error {
		records, err := app.FindAllRecords("feed_items")
		if err != nil {
			return err
		}

		for _, record := range records {
			if strings.TrimSpace(record.GetString("origin_type")) != "" {
				continue
			}
			record.Set("origin_type", "feed")
			if err := app.Save(record); err != nil {
				return err
			}
		}

		var columns []sqliteFeedItemsDefaultColumn
		if err := app.DB().NewQuery("PRAGMA table_info(`feed_items`)").All(&columns); err != nil {
			return err
		}

		for _, column := range columns {
			if column.Name == "origin_type" && strings.Contains(strings.ToLower(column.DfltValue), "feed") {
				return nil
			}
		}

		statements := []string{
			"DROP TABLE IF EXISTS feed_items__rebuilt",
			"CREATE TABLE feed_items__rebuilt (`created` TEXT DEFAULT '' NOT NULL, `external_id` TEXT DEFAULT '' NOT NULL, `id` TEXT PRIMARY KEY DEFAULT ('r'||lower(hex(randomblob(7)))) NOT NULL, `keywords_json` JSON DEFAULT NULL, `link` TEXT DEFAULT '' NOT NULL, `published_at` TEXT DEFAULT '' NOT NULL, `source_id` TEXT DEFAULT NULL, `summary` TEXT DEFAULT '' NOT NULL, `tags_json` JSON DEFAULT NULL, `title` TEXT DEFAULT '' NOT NULL, `updated` TEXT DEFAULT '' NOT NULL, `origin_type` TEXT DEFAULT 'feed' NOT NULL, `read_state` TEXT DEFAULT '' NOT NULL, `is_starred` BOOLEAN DEFAULT FALSE NOT NULL)",
			"INSERT INTO feed_items__rebuilt (`created`, `external_id`, `id`, `keywords_json`, `link`, `published_at`, `source_id`, `summary`, `tags_json`, `title`, `updated`, `origin_type`, `read_state`, `is_starred`) SELECT `created`, `external_id`, `id`, `keywords_json`, `link`, `published_at`, `source_id`, `summary`, `tags_json`, `title`, `updated`, CASE WHEN COALESCE(`origin_type`, '') = '' THEN 'feed' ELSE `origin_type` END, `read_state`, COALESCE(`is_starred`, FALSE) FROM feed_items",
			"DROP TABLE feed_items",
			"ALTER TABLE feed_items__rebuilt RENAME TO feed_items",
			"CREATE UNIQUE INDEX idx_feed_items_source_external_id ON feed_items (source_id, external_id)",
		}

		for _, statement := range statements {
			if _, err := app.DB().NewQuery(statement).Execute(); err != nil {
				return fmt.Errorf("rebuild feed_items origin_type default: %w", err)
			}
		}

		return nil
	}, func(app core.App) error {
		return nil
	})
}