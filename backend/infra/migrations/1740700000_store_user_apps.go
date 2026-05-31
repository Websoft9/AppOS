package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		col := core.NewBaseCollection("store_user_apps")

		col.Fields.Add(&core.TextField{Name: "user", Required: true, Max: 64})
		col.Fields.Add(&core.TextField{Name: "app_key", Required: true, Max: 255})
		col.Fields.Add(&core.BoolField{Name: "is_favorite"})
		col.Fields.Add(&core.TextField{Name: "note", Max: 10000})
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		col.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

		rule := "user = @request.auth.id"
		col.ListRule = &rule
		col.ViewRule = &rule
		col.CreateRule = &rule
		col.UpdateRule = &rule
		col.DeleteRule = &rule

		col.Indexes = []string{"CREATE UNIQUE INDEX idx_store_user_apps_user_app ON store_user_apps (user, app_key)"}
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("store_user_apps")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}
