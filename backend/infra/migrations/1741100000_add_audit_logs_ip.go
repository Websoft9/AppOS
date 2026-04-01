package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Adds ip TextField to audit_logs to record the client source IP for each operation.
func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("audit_logs")
		if err != nil {
			return err
		}

		// Idempotent: skip if already present (e.g. fresh installs with 1741000000).
		if col.Fields.GetByName("ip") != nil {
			return nil
		}

		col.Fields.Add(&core.TextField{Name: "ip"})

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("audit_logs")
		if err != nil {
			return nil
		}
		col.Fields.RemoveByName("ip")
		return app.Save(col)
	})
}
