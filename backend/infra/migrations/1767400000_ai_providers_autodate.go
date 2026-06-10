package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/infra/collections"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.AIProviders)
		if err != nil {
			return nil
		}

		addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
		addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

		return app.Save(col)
	}, func(app core.App) error {
		return nil
	})
}
