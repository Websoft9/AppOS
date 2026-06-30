package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/infra/collections"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.AICopilotSessions)
		if err != nil {
			return nil
		}
		addFieldIfMissing(col, &core.TextField{Name: "system_prompt_asset_id", Max: 100})
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.AICopilotSessions)
		if err != nil {
			return nil
		}
		col.Fields.RemoveByName("system_prompt_asset_id")
		return app.Save(col)
	})
}
