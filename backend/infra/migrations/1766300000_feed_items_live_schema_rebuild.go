package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

type sqliteTableColumn struct {
	Name    string `db:"name"`
	NotNull int    `db:"notnull"`
}

// Story 27.x: rebuild legacy live feed_items tables so bookmark records can omit source_id.
func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_items")
		if err != nil {
			return err
		}

		if field, ok := col.Fields.GetByName("source_id").(*core.RelationField); ok {
			field.Required = false
		}
		col.Fields.RemoveByName("state")
		col.Indexes = []string{"CREATE UNIQUE INDEX idx_feed_items_source_external_id ON feed_items (source_id, external_id)"}
		if err := app.Save(col); err != nil {
			return err
		}

		var columns []sqliteTableColumn
		if err := app.DB().NewQuery("PRAGMA table_info(`feed_items`)").All(&columns); err != nil {
			return err
		}

		hasStateColumn := false
		sourceIDNotNull := false
		for _, column := range columns {
			switch column.Name {
			case "state":
				hasStateColumn = true
			case "source_id":
				sourceIDNotNull = column.NotNull == 1
			}
		}

		if !hasStateColumn && !sourceIDNotNull {
			return nil
		}

		readStateExpr := "CASE WHEN COALESCE(`read_state`, '') <> '' THEN `read_state` ELSE 'unread' END"
		if hasStateColumn {
			readStateExpr = "CASE WHEN COALESCE(`read_state`, '') <> '' THEN `read_state` WHEN COALESCE(`state`, '') = 'reviewed' THEN 'read' ELSE 'unread' END"
		}

		statements := []string{
			"DROP TABLE IF EXISTS feed_items__rebuilt",
			"CREATE TABLE feed_items__rebuilt (`created` TEXT DEFAULT '' NOT NULL, `external_id` TEXT DEFAULT '' NOT NULL, `id` TEXT PRIMARY KEY DEFAULT ('r'||lower(hex(randomblob(7)))) NOT NULL, `keywords_json` JSON DEFAULT NULL, `link` TEXT DEFAULT '' NOT NULL, `published_at` TEXT DEFAULT '' NOT NULL, `source_id` TEXT DEFAULT NULL, `summary` TEXT DEFAULT '' NOT NULL, `tags_json` JSON DEFAULT NULL, `title` TEXT DEFAULT '' NOT NULL, `updated` TEXT DEFAULT '' NOT NULL, `origin_type` TEXT DEFAULT '' NOT NULL, `read_state` TEXT DEFAULT '' NOT NULL, `is_starred` BOOLEAN DEFAULT FALSE NOT NULL)",
			fmt.Sprintf("INSERT INTO feed_items__rebuilt (`created`, `external_id`, `id`, `keywords_json`, `link`, `published_at`, `source_id`, `summary`, `tags_json`, `title`, `updated`, `origin_type`, `read_state`, `is_starred`) SELECT `created`, `external_id`, `id`, `keywords_json`, `link`, `published_at`, NULLIF(`source_id`, ''), `summary`, `tags_json`, `title`, `updated`, CASE WHEN COALESCE(`origin_type`, '') = '' THEN 'feed' ELSE `origin_type` END, %s, COALESCE(`is_starred`, FALSE) FROM feed_items", readStateExpr),
			"DROP TABLE feed_items",
			"ALTER TABLE feed_items__rebuilt RENAME TO feed_items",
			"CREATE UNIQUE INDEX idx_feed_items_source_external_id ON feed_items (source_id, external_id)",
		}

		for _, statement := range statements {
			if _, err := app.DB().NewQuery(statement).Execute(); err != nil {
				return fmt.Errorf("rebuild feed_items live schema: %w", err)
			}
		}

		return nil
	}, func(app core.App) error {
		return nil
	})
}