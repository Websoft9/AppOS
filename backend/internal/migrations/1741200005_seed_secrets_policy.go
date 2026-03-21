package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/internal/secrets"
	"github.com/websoft9/appos/backend/internal/settings"
)

// Story 19.4: Seed default secrets/policy settings row.
func init() {
	m.Register(func(app core.App) error {
		_, err := app.FindFirstRecordByFilter(
			"app_settings",
			"module = {:module} && key = {:key}",
			dbx.Params{"module": secrets.SettingsModule, "key": secrets.PolicySettingsKey},
		)
		if err == nil {
			return nil
		}

		return settings.SetGroup(app, secrets.SettingsModule, secrets.PolicySettingsKey, secrets.DefaultPolicy().ToMap())
	}, func(app core.App) error {
		return nil
	})
}
