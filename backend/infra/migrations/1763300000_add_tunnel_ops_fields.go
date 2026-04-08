package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Story 16.3: add persistent tunnel operator fields for current/last session visibility.
func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return err
		}

		if col.Fields.GetByName("tunnel_connected_at") == nil {
			col.Fields.Add(&core.DateField{Name: "tunnel_connected_at"})
		}
		if col.Fields.GetByName("tunnel_remote_addr") == nil {
			col.Fields.Add(&core.TextField{Name: "tunnel_remote_addr"})
		}
		if col.Fields.GetByName("tunnel_disconnect_at") == nil {
			col.Fields.Add(&core.DateField{Name: "tunnel_disconnect_at"})
		}
		if col.Fields.GetByName("tunnel_disconnect_reason") == nil {
			col.Fields.Add(&core.TextField{Name: "tunnel_disconnect_reason"})
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return nil
		}

		col.Fields.RemoveByName("tunnel_connected_at")
		col.Fields.RemoveByName("tunnel_remote_addr")
		col.Fields.RemoveByName("tunnel_disconnect_at")
		col.Fields.RemoveByName("tunnel_disconnect_reason")
		return app.Save(col)
	})
}
