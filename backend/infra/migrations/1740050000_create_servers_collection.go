package migrations

// Story 20.1: Create the `servers` collection with all MVP fields.
//
// Consolidates what was previously spread across four migrations:
//   1740000000 (initial create, with auth_type)
//   1741400000 (add shell)
//   1741500000 (add tunnel fields)
//   1762700000 (remove auth_type)
//
// Final schema — auth_type is intentionally omitted; credential type is
// inferred from the referenced secret's template_id at the backend layer.

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		secrets, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return err
		}

		servers := core.NewBaseCollection("servers")
		servers.ListRule = types.Pointer("@request.auth.id != ''")
		servers.ViewRule = types.Pointer("@request.auth.id != ''")
		servers.CreateRule = nil
		servers.UpdateRule = nil
		servers.DeleteRule = nil

		// ─── Core identity ────────────────────────────────────
		servers.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      200,
		})
		servers.Fields.Add(&core.TextField{
			Name:     "host",
			Required: false,
		})
		servers.Fields.Add(&core.NumberField{
			Name:    "port",
			OnlyInt: true,
			Min:     types.Pointer(1.0),
			Max:     types.Pointer(65535.0),
		})
		servers.Fields.Add(&core.TextField{
			Name:     "user",
			Required: true,
		})

		// ─── Connection ───────────────────────────────────────
		// connect_type: "direct" (default) | "tunnel"
		servers.Fields.Add(&core.TextField{
			Name:     "connect_type",
			Required: false,
		})
		// Credential secret — type inferred from secret.template_id:
		//   single_value → password auth
		//   ssh_key      → key-based auth
		servers.Fields.Add(&core.RelationField{
			Name:         "credential",
			CollectionId: secrets.Id,
			MaxSelect:    1,
		})
		// Override login shell; empty = server default
		servers.Fields.Add(&core.TextField{
			Name:     "shell",
			Required: false,
		})

		// ─── Tunnel state (written by backend, read-only in UI) ──
		servers.Fields.Add(&core.TextField{
			Name:     "tunnel_status",
			Required: false,
		})
		servers.Fields.Add(&core.DateField{
			Name:     "tunnel_last_seen",
			Required: false,
		})
		servers.Fields.Add(&core.DateField{
			Name:     "tunnel_connected_at",
			Required: false,
		})
		servers.Fields.Add(&core.TextField{
			Name:     "tunnel_remote_addr",
			Required: false,
		})
		servers.Fields.Add(&core.DateField{
			Name:     "tunnel_disconnect_at",
			Required: false,
		})
		servers.Fields.Add(&core.TextField{
			Name:     "tunnel_disconnect_reason",
			Required: false,
		})
		servers.Fields.Add(&core.DateField{
			Name:     "tunnel_pause_until",
			Required: false,
		})
		servers.Fields.Add(&core.JSONField{
			Name: "tunnel_forwards",
		})
		servers.Fields.Add(&core.JSONField{
			Name: "tunnel_services",
		})

		// ─── Metadata ─────────────────────────────────────────
		servers.Fields.Add(&core.TextField{
			Name: "description",
		})

		servers.AddIndex("idx_servers_name", true, "name", "")

		return app.Save(servers)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return nil // already gone
		}
		return app.Delete(col)
	})
}
