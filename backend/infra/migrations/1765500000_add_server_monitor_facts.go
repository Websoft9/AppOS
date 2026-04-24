package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return err
		}

		addFieldIfMissing(col, &core.JSONField{Name: "facts_json", MaxSize: 1 << 20})
		addFieldIfMissing(col, &core.DateField{Name: "facts_observed_at"})

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return nil
		}

		col.Fields.RemoveByName("facts_json")
		col.Fields.RemoveByName("facts_observed_at")
		return app.Save(col)
	})
}