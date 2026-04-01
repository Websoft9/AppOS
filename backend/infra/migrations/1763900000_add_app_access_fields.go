package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("app_instances")
		if err != nil {
			return err
		}
		col.Fields.Add(&core.TextField{Name: "access_username"})
		col.Fields.Add(&core.TextField{Name: "access_secret_hint"})
		col.Fields.Add(&core.TextField{Name: "access_retrieval_method"})
		col.Fields.Add(&core.TextField{Name: "access_notes"})
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("app_instances")
		if err != nil {
			return err
		}
		col.Fields.RemoveByName("access_username")
		col.Fields.RemoveByName("access_secret_hint")
		col.Fields.RemoveByName("access_retrieval_method")
		col.Fields.RemoveByName("access_notes")
		return app.Save(col)
	})
}