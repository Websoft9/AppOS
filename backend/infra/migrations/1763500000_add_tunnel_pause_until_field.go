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

		if col.Fields.GetByName("tunnel_pause_until") == nil {
			col.Fields.Add(&core.DateField{Name: "tunnel_pause_until"})
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return nil
		}

		col.Fields.RemoveByName("tunnel_pause_until")
		return app.Save(col)
	})
}