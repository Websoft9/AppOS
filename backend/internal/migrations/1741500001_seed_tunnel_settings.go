package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/internal/settings"
)

// Story 16.2: Seed default tunnel port range in app_settings.
//
// Inserts (module="tunnel", key="port_range") with default start/end values.
// With two ports per server (SSH + HTTP), the 40000–49999 range supports ~5,000
// concurrent tunnel servers.
//
// Uses insert-if-not-exists — idempotent on repeated runs.
// The down() function is a no-op (seed data is never rolled back).
func init() {
	m.Register(func(app core.App) error {
		// Insert-if-not-exists.
		_, err := app.FindFirstRecordByFilter(
			"app_settings",
			"module = {:module} && key = {:key}",
			dbx.Params{"module": "tunnel", "key": "port_range"},
		)
		if err == nil {
			// Row already present — skip seed.
			return nil
		}
		return settings.SetGroup(app, "tunnel", "port_range", map[string]any{
			"start": 40000,
			"end":   49999,
		})
	}, func(app core.App) error {
		return nil
	})
}
