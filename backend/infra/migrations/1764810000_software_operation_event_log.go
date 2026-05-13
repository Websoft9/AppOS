package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/infra/collections"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.SoftwareOperations)
		if err != nil {
			return nil
		}
		addFieldIfMissing(col, &core.TextField{Name: "event_log", Max: 20000})
		return app.Save(col)
	}, func(app core.App) error {
		return nil
	})
}
