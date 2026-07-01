package schema

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/deploy"
)

func EnsureDeploymentsCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId("deployments")
	if err != nil {
		col = core.NewBaseCollection("deployments")
	}
	col.ListRule = authenticatedRule()
	col.ViewRule = authenticatedRule()
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.TextField{Name: "server_id"})
	addFieldIfMissing(col, &core.SelectField{Name: "source", Required: true, MaxSelect: 1, Values: []string{"manualops", "fileops", "gitops", "store"}})
	addFieldIfMissing(col, &core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: deploy.StatusValues()})
	addFieldIfMissing(col, &core.TextField{Name: "adapter"})
	addFieldIfMissing(col, &core.TextField{Name: "compose_project_name"})
	addFieldIfMissing(col, &core.TextField{Name: "project_dir"})
	addFieldIfMissing(col, &core.JSONField{Name: "spec"})
	addFieldIfMissing(col, &core.TextField{Name: "rendered_compose"})
	addFieldIfMissing(col, &core.TextField{Name: "execution_log"})
	addFieldIfMissing(col, &core.BoolField{Name: "execution_log_truncated"})
	addFieldIfMissing(col, &core.TextField{Name: "error_summary"})
	addFieldIfMissing(col, &core.TextField{Name: "current_step"})
	addFieldIfMissing(col, &core.SelectField{Name: "step_status", MaxSelect: 1, Values: deploy.StepStatusValues()})
	addFieldIfMissing(col, &core.JSONField{Name: "last_error"})
	addFieldIfMissing(col, &core.JSONField{Name: "release_snapshot"})
	addFieldIfMissing(col, &core.DateField{Name: "started_at"})
	addFieldIfMissing(col, &core.DateField{Name: "finished_at"})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_deployments_status", false, "status", "")
	col.AddIndex("idx_deployments_server_id", false, "server_id", "")
	col.AddIndex("idx_deployments_source", false, "source", "")
	return app.Save(col)
}
