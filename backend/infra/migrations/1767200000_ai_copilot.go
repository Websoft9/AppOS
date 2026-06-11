package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/infra/collections"
)

func init() {
	m.Register(func(app core.App) error {
		if err := ensureAICopilotSessionsCollection(app); err != nil {
			return err
		}
		return ensureAICopilotMessagesCollection(app)
	}, func(app core.App) error {
		if col, err := app.FindCollectionByNameOrId(collections.AICopilotMessages); err == nil {
			if err := app.Delete(col); err != nil {
				return err
			}
		}
		if col, err := app.FindCollectionByNameOrId(collections.AICopilotSessions); err == nil {
			return app.Delete(col)
		}
		return nil
	})
}

func ensureAICopilotSessionsCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId(collections.AICopilotSessions)
	if err != nil {
		col = core.NewBaseCollection(collections.AICopilotSessions)
	}
	col.ListRule = types.Pointer("@request.auth.collectionName = '_superusers'")
	col.ViewRule = types.Pointer("@request.auth.collectionName = '_superusers'")
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.TextField{Name: "owner_id", Required: true, Max: 100})
	addFieldIfMissing(col, &core.TextField{Name: "title", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "last_message_at", Max: 80})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_ai_copilot_sessions_owner_last", false, "owner_id, last_message_at", "")
	return app.Save(col)
}

func ensureAICopilotMessagesCollection(app core.App) error {
	sessionsCol, err := app.FindCollectionByNameOrId(collections.AICopilotSessions)
	if err != nil {
		return err
	}
	col, err := app.FindCollectionByNameOrId(collections.AICopilotMessages)
	if err != nil {
		col = core.NewBaseCollection(collections.AICopilotMessages)
	}
	col.ListRule = types.Pointer("@request.auth.collectionName = '_superusers'")
	col.ViewRule = types.Pointer("@request.auth.collectionName = '_superusers'")
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
