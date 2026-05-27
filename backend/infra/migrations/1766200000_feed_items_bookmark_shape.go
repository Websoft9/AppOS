package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Story 27.x: evolve existing feed_items collections to support bookmark-shaped items.
func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_items")
		if err != nil {
			return err
		}

		if field, ok := col.Fields.GetByName("source_id").(*core.RelationField); ok {
			field.Required = false
		}

		if col.Fields.GetByName("origin_type") == nil {
			col.Fields.Add(&core.SelectField{Name: "origin_type", Required: true, MaxSelect: 1, Values: []string{"feed", "bookmark"}})
		}
		if col.Fields.GetByName("read_state") == nil {
			col.Fields.Add(&core.SelectField{Name: "read_state", Required: true, MaxSelect: 1, Values: []string{"unread", "read"}})
		}
		if col.Fields.GetByName("is_starred") == nil {
			col.Fields.Add(&core.BoolField{Name: "is_starred"})
		}

		if err := app.Save(col); err != nil {
			return err
		}

		records, err := app.FindAllRecords("feed_items")
		if err != nil {
			return err
		}
		for _, record := range records {
			if record.GetString("origin_type") == "" {
				record.Set("origin_type", "feed")
			}
			if record.GetString("read_state") == "" {
				record.Set("read_state", "unread")
			}
			if record.Get("is_starred") == nil {
				record.Set("is_starred", false)
			}
			if err := app.Save(record); err != nil {
				return err
			}
		}

		return nil
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_items")
		if err != nil {
			return nil
		}

		if field, ok := col.Fields.GetByName("source_id").(*core.RelationField); ok {
			field.Required = true
		}
		col.Fields.RemoveByName("origin_type")
		col.Fields.RemoveByName("read_state")
		col.Fields.RemoveByName("is_starred")
		return app.Save(col)
	})
}