package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Epic 9: adds a `size` (number) field to user_files to store file size in bytes.
// The field is optional — existing records will have 0 / null.
func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("user_files")
		if err != nil {
			return err
		}

		col.Fields.Add(&core.NumberField{
			Name: "size",
			Min:  func() *float64 { v := float64(0); return &v }(),
		})

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("user_files")
		if err != nil {
			return nil // already removed
		}

		col.Fields.RemoveByName("size")
		return app.Save(col)
	})
}
