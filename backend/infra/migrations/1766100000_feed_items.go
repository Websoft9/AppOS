package migrations

import (
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
		col.Fields.Add(&core.JSONField{Name: "keywords_json"})
		col.Fields.Add(&core.JSONField{Name: "tags_json"})
		col.Fields.Add(&core.SelectField{Name: "read_state", Required: true, MaxSelect: 1, Values: []string{"unread", "read"}})
		col.Fields.Add(&core.BoolField{Name: "is_starred"})
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		col.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

		col.Indexes = append(col.Indexes,
			"CREATE UNIQUE INDEX idx_feed_items_source_external_id ON feed_items (source_id, external_id)",
		)

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_items")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}