package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Epic 9 rebrand: rename the app_settings module key from "files" → "space".
//
// The seed migration (1741200001) inserted the row as module="files".
// After this migration the row becomes module="space" to match the new
// /api/ext/space/* route group and settings allowlist.
//
// Down: renames "space" back to "files" for rollback safety.
func init() {
	m.Register(func(app core.App) error {
		_, err := app.DB().NewQuery(
			"UPDATE app_settings SET module = 'space' WHERE module = 'files' AND key = 'quota'",
		).Execute()
		return err
	}, func(app core.App) error {
		_, err := app.DB().NewQuery(
			"UPDATE app_settings SET module = 'files' WHERE module = 'space' AND key = 'quota'",
		).Execute()
		return err
	})
}
