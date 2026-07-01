package schema

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/infra/collections"
)

func EnsureAICopilotMessagesCollection(app core.App) error {
	sessionsCol, err := app.FindCollectionByNameOrId(collections.AICopilotSessions)
	if err != nil {
		return err
	}
	col, err := app.FindCollectionByNameOrId(collections.AICopilotMessages)
	if err != nil {
		col = core.NewBaseCollection(collections.AICopilotMessages)
	}
	superRule := types.Pointer("@request.auth.collectionName = '_superusers'")
	col.ListRule = superRule
	col.ViewRule = superRule
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.RelationField{Name: "session", Required: true, CollectionId: sessionsCol.Id, MaxSelect: 1, CascadeDelete: true})
	addFieldIfMissing(col, &core.SelectField{Name: "role", Required: true, MaxSelect: 1, Values: []string{"system", "user", "assistant"}})
	addFieldIfMissing(col, &core.TextField{Name: "content", Required: true, Max: 200000})
	addFieldIfMissing(col, &core.SelectField{Name: "status", MaxSelect: 1, Values: []string{"completed", "failed"}})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_ai_copilot_messages_session_created", false, "session, created", "")
	return app.Save(col)
}
