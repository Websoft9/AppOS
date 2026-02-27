package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Story 16.2: Add tunnel management fields to the `servers` collection.
//
// New optional fields (all have zero-value defaults — existing direct-SSH servers
// are completely unaffected):
//
//	connect_type    text   "direct" (default) | "tunnel"
//	tunnel_status   text   "online" | "offline" | "" (empty when not a tunnel server)
//	tunnel_last_seen datetime  nullable UTC timestamp of last heartbeat
//	tunnel_services  json   port mapping written by backend on first tunnel connect
func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return err
		}

		col.Fields.Add(&core.TextField{
			Name:     "connect_type",
			Required: false,
		})
		col.Fields.Add(&core.TextField{
			Name:     "tunnel_status",
			Required: false,
		})
		col.Fields.Add(&core.DateField{
			Name:     "tunnel_last_seen",
			Required: false,
		})
		col.Fields.Add(&core.JSONField{
			Name: "tunnel_services",
		})

		return app.Save(col)
	}, func(app core.App) error {
		// All fields are additive — rollback is a no-op.
		// Removing fields risks data loss; callers should handle via manual SQL if needed.
		return nil
	})
}
