package schema

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/infra/collections"
)

func EnsureAICopilotSessionsCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId(collections.AICopilotSessions)
	if err != nil {
		col = core.NewBaseCollection(collections.AICopilotSessions)
	}
	superRule := types.Pointer("@request.auth.collectionName = '_superusers'")
	col.ListRule = superRule
	col.ViewRule = superRule
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.TextField{Name: "owner_id", Required: true, Max: 100})
	addFieldIfMissing(col, &core.TextField{Name: "title", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "last_message_at", Max: 80})
	addFieldIfMissing(col, &core.TextField{Name: "system_prompt_asset_id", Max: 100})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_ai_copilot_sessions_owner_last", false, "owner_id, last_message_at", "")
	return app.Save(col)
}
