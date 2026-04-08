package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Story 16.4: add desired tunnel forward configuration storage.
func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return err
		}

		if col.Fields.GetByName("tunnel_forwards") == nil {
			col.Fields.Add(&core.JSONField{Name: "tunnel_forwards"})
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return nil
		}

		col.Fields.RemoveByName("tunnel_forwards")
		return app.Save(col)
	})
}
