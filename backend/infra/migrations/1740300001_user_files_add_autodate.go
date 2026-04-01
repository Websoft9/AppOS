package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds created/updated autodate fields to user_files collection.
// The original migration (1740300000) created the collection as a BaseCollection
// which does NOT include autodate fields by default — this fixes it.
func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("user_files")
		if err != nil {
			return err
		}

		col.Fields.Add(&core.AutodateField{
			Name:     "created",
			OnCreate: true,
		})
		col.Fields.Add(&core.AutodateField{
			Name:     "updated",
			OnCreate: true,
			OnUpdate: true,
		})

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("user_files")
		if err != nil {
			return nil
		}

		col.Fields.RemoveByName("created")
		col.Fields.RemoveByName("updated")

		return app.Save(col)
	})
}
