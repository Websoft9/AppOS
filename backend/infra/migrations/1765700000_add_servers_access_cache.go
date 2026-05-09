package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// 1765700000 – add access_status, access_reason, access_checked_at to the
// servers collection to cache the result of the last TCP/SSH connectivity
// probe. The list endpoint reads from these fields (fast DB lookup) instead
// of running a live probe on every page load.
func init() {
	m.Register(func(app core.App) error {
		servers, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return err
		}

		servers.Fields.Add(&core.TextField{
			Name:     "access_status",
			Required: false,
		})
		servers.Fields.Add(&core.TextField{
			Name:     "access_reason",
			Required: false,
		})
		servers.Fields.Add(&core.DateField{
			Name:     "access_checked_at",
			Required: false,
		})

		return app.Save(servers)
	}, func(app core.App) error {
		servers, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return err
		}

		for _, name := range []string{"access_status", "access_reason", "access_checked_at"} {
			if f := servers.Fields.GetByName(name); f != nil {
				servers.Fields.RemoveById(f.GetId())
			}
		}

		return app.Save(servers)
	})
}
