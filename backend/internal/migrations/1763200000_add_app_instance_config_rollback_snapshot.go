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
		if col.Fields.GetByName("config_rollback_snapshot") == nil {
			col.Fields.Add(&core.JSONField{Name: "config_rollback_snapshot"})
		}
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("app_instances")
		if err != nil {
			return nil
		}
		col.Fields.RemoveByName("config_rollback_snapshot")
		return app.Save(col)
	})
}
