package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/internal/settings"
)

// Story 13.2: Seed the default files/quota row in app_settings.
//
// Uses an insert-if-not-exists pattern: if the row already exists (e.g. the
// admin has already customised it), the migration does nothing.
// The down() function is a no-op — seed data is never rolled back.
func init() {
	m.Register(func(app core.App) error {
		// Check if the row already exists.
		_, err := app.FindFirstRecordByFilter(
			"app_settings",
			"module = {:module} && key = {:key}",
			dbx.Params{"module": "files", "key": "quota"},
		)
		if err == nil {
			// Row already present — skip seed.
			return nil
		}

		// Insert default quota row.
		return settings.SetGroup(app, "files", "quota", map[string]any{
			"maxSizeMB":            10,
			"maxPerUser":           100,
			"shareMaxMinutes":      60,
			"shareDefaultMinutes":  30,
		})
	}, func(app core.App) error {
		// Down: no-op — seed data is not rolled back.
		return nil
	})
}
