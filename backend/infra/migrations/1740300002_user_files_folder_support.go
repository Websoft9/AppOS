package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds folder support to user_files:
//   - is_folder (bool): true = directory, false = regular file
//   - parent  (text):   ID of the parent folder record; empty = root
func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("user_files")
		if err != nil {
			return err
		}

		col.Fields.Add(&core.BoolField{
			Name: "is_folder",
		})
		col.Fields.Add(&core.TextField{
			Name: "parent",
			Max:  64,
		})

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("user_files")
		if err != nil {
			return nil
		}
		col.Fields.RemoveByName("is_folder")
		col.Fields.RemoveByName("parent")
		return app.Save(col)
	})
}
