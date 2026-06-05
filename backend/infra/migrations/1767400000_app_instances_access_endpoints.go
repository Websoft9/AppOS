package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := ensureAppInstancesCollection(app)
		if err != nil {
			return err
		}
		addFieldIfMissing(col, &core.JSONField{Name: "access_endpoints", MaxSize: 1 << 20})
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("app_instances")
		if err != nil {
			return nil
		}
		col.Fields.RemoveByName("access_endpoints")
		return app.Save(col)
	})
}
