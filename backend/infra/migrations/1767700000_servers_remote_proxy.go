package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return nil
		}

		addFieldIfMissing(col, &core.JSONField{Name: "remote_proxy", MaxSize: 1 << 16})
		return app.Save(col)
	}, func(app core.App) error {
		return nil
	})
}
