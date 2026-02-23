package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/internal/settings"
)

// Story 13.5: Seed default rows for proxy/network, docker/mirror,
// docker/registries, and llm/providers in app_settings.
//
// Uses an insert-if-not-exists pattern for each row.
// The down() function is a no-op — seed data is never rolled back.
func init() {
	type seedRow struct {
		module string
		key    string
		value  map[string]any
	}

	rows := []seedRow{
		{
			module: "proxy",
			key:    "network",
			value: map[string]any{
				"httpProxy": "", "httpsProxy": "", "noProxy": "",
				"username": "", "password": "",
			},
		},
		{
			module: "docker",
			key:    "mirror",
			value:  map[string]any{"mirrors": []any{}, "insecureRegistries": []any{}},
		},
		{
			module: "docker",
			key:    "registries",
			value:  map[string]any{"items": []any{}},
		},
		{
			module: "llm",
			key:    "providers",
			value:  map[string]any{"items": []any{}},
		},
	}

	m.Register(func(app core.App) error {
		for _, row := range rows {
			// Insert-if-not-exists: check before seeding.
			_, err := app.FindFirstRecordByFilter(
				"app_settings",
				"module = {:module} && key = {:key}",
				dbx.Params{"module": row.module, "key": row.key},
			)
			if err == nil {
				// Row already exists — skip.
				continue
			}
			if err := settings.SetGroup(app, row.module, row.key, row.value); err != nil {
				return err
			}
		}
		return nil
	}, func(app core.App) error {
		// Down: no-op — seed data is not rolled back.
		return nil
	})
}
