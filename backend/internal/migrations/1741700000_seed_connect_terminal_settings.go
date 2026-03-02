package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/internal/settings"
)

// Story 13.7: Seed default connect/terminal settings row.
func init() {
	m.Register(func(app core.App) error {
		_, err := app.FindFirstRecordByFilter(
			"app_settings",
			"module = {:module} && key = {:key}",
			dbx.Params{"module": "connect", "key": "terminal"},
		)
		if err == nil {
			return nil
		}
		return settings.SetGroup(app, "connect", "terminal", map[string]any{
			"idleTimeoutSeconds": 1800,
			"maxConnections":     0,
		})
	}, func(app core.App) error {
		return nil
	})
}
