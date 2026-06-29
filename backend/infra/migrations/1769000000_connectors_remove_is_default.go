package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/infra/collections"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.Connectors)
		if err != nil {
			return err
		}
		removeFieldIfExists(col, "is_default")
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.Connectors)
		if err != nil {
			return err
		}
		addFieldIfMissing(col, &core.BoolField{Name: "is_default"})
		return app.Save(col)
	})
}