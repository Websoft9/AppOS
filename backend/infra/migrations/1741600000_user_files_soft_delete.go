package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Epic 9: adds `is_deleted` (bool, default false) to user_files for soft-delete / trash support.
// Deleted records remain in the DB but are hidden from the normal list view and
// shown in the Trash view instead.  Permanent deletion (hard delete) empties the trash.
func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("user_files")
		if err != nil {
			return err
		}

		col.Fields.Add(&core.BoolField{
			Name: "is_deleted",
		})

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("user_files")
		if err != nil {
			return nil // already removed
		}

		col.Fields.RemoveByName("is_deleted")
		return app.Save(col)
	})
}
