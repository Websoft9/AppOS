package schema

import "github.com/pocketbase/pocketbase/core"

func EnsureAuditLogsCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId("audit_logs")
	if err != nil {
		col = core.NewBaseCollection("audit_logs")
	}
	rule := "user_id = @request.auth.id || @request.auth.collectionName = '_superusers'"
	col.ListRule = &rule
	col.ViewRule = &rule
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.TextField{Name: "user_id", Required: true})
	addFieldIfMissing(col, &core.TextField{Name: "user_email"})
	addFieldIfMissing(col, &core.TextField{Name: "action", Required: true})
	addFieldIfMissing(col, &core.TextField{Name: "resource_type"})
	addFieldIfMissing(col, &core.TextField{Name: "resource_id"})
	addFieldIfMissing(col, &core.TextField{Name: "resource_name"})
	addFieldIfMissing(col, &core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"pending", "success", "failed", "attention_required"}})
	addFieldIfMissing(col, &core.TextField{Name: "ip"})
	addFieldIfMissing(col, &core.JSONField{Name: "detail"})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_audit_logs_user_id", false, "user_id", "")
	col.AddIndex("idx_audit_logs_action", false, "action", "")
	return app.Save(col)
}
