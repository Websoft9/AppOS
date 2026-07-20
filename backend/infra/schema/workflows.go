package schema

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/workflow"
	"github.com/websoft9/appos/backend/infra/collections"
)

func EnsureWorkflowsCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId(collections.Workflows)
	if err != nil {
		col = core.NewBaseCollection(collections.Workflows)
	}
	superRule := types.Pointer("@request.auth.collectionName = '_superusers'")
	col.ListRule = superRule
	col.ViewRule = superRule
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "description", Max: 1000})
	addFieldIfMissing(col, &core.BoolField{Name: "is_enabled"})
	addFieldIfMissing(col, &core.TextField{Name: "definition_yaml", Required: true, Max: 1 << 20})
	addFieldIfMissing(col, &core.TextField{Name: "default_server_id", Max: 100})
	addFieldIfMissing(col, &core.JSONField{Name: "trigger_types_json"})
	addFieldIfMissing(col, &core.NumberField{Name: "node_count", OnlyInt: true})
	addFieldIfMissing(col, &core.BoolField{Name: "has_ai_nodes"})
	addFieldIfMissing(col, &core.TextField{Name: "created_by", Max: 100})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_workflows_name", false, "name", "")
	col.AddIndex("idx_workflows_enabled", false, "is_enabled", "")
	return app.Save(col)
}

func EnsureWorkflowRunsCollection(app core.App) error {
	workflows, err := app.FindCollectionByNameOrId(collections.Workflows)
	if err != nil {
		return err
	}
	col, err := app.FindCollectionByNameOrId(collections.WorkflowRuns)
	if err != nil {
		col = core.NewBaseCollection(collections.WorkflowRuns)
	}
	superRule := types.Pointer("@request.auth.collectionName = '_superusers'")
	col.ListRule = superRule
	col.ViewRule = superRule
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.RelationField{Name: "workflow_definition", CollectionId: workflows.Id, Required: true, MaxSelect: 1, CascadeDelete: true})
	addFieldIfMissing(col, &core.TextField{Name: "definition_yaml", Required: true, Max: 1 << 20})
	addFieldIfMissing(col, &core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{workflow.RunStatusPending, workflow.RunStatusRunning, workflow.RunStatusSucceeded, workflow.RunStatusFailed, workflow.RunStatusCancelled, workflow.RunStatusWaiting, workflow.RunStatusManualGate}})
	addFieldIfMissing(col, &core.SelectField{Name: "trigger_type", Required: true, MaxSelect: 1, Values: workflow.SupportedTriggerTypes})
	addFieldIfMissing(col, &core.TextField{Name: "execution_owner_id", Max: 100})
	addFieldIfMissing(col, &core.TextField{Name: "requested_by", Max: 100})
	addFieldIfMissing(col, &core.TextField{Name: "requested_by_email", Max: 200})
	addFieldIfMissing(col, &core.JSONField{Name: "params_json"})
	addFieldIfMissing(col, &core.TextField{Name: "resolved_server_id", Max: 100})
	addFieldIfMissing(col, &core.SelectField{Name: "overlap_policy", MaxSelect: 1, Values: []string{workflow.OverlapPolicySkip}})
	addFieldIfMissing(col, &core.TextField{Name: "error_message", Max: 4000})
	addFieldIfMissing(col, &core.DateField{Name: "started_at"})
	addFieldIfMissing(col, &core.DateField{Name: "ended_at"})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_workflow_runs_workflow_status", false, "workflow_definition,status", "")
	col.AddIndex("idx_workflow_runs_status", false, "status", "")
	return app.Save(col)
}

func EnsureWorkflowNodeRunsCollection(app core.App) error {
	runs, err := app.FindCollectionByNameOrId(collections.WorkflowRuns)
	if err != nil {
		return err
	}
	col, err := app.FindCollectionByNameOrId(collections.WorkflowNodeRuns)
	if err != nil {
		col = core.NewBaseCollection(collections.WorkflowNodeRuns)
	}
	superRule := types.Pointer("@request.auth.collectionName = '_superusers'")
	col.ListRule = superRule
	col.ViewRule = superRule
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.RelationField{Name: "workflow_run", CollectionId: runs.Id, Required: true, MaxSelect: 1, CascadeDelete: true})
	addFieldIfMissing(col, &core.TextField{Name: "node_key", Required: true})
	addFieldIfMissing(col, &core.TextField{Name: "node_type", Required: true})
	addFieldIfMissing(col, &core.TextField{Name: "display_name", Required: true})
	addFieldIfMissing(col, &core.JSONField{Name: "depends_on_json"})
	addFieldIfMissing(col, &core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{workflow.NodeStatusPending, workflow.NodeStatusRunning, workflow.NodeStatusSucceeded, workflow.NodeStatusFailed, workflow.NodeStatusSkipped, workflow.NodeStatusCancelled, workflow.NodeStatusWaiting, workflow.NodeStatusManualGate}})
	addFieldIfMissing(col, &core.NumberField{Name: "retry_count", OnlyInt: true})
	addFieldIfMissing(col, &core.JSONField{Name: "output_json"})
	addFieldIfMissing(col, &core.TextField{Name: "error_message", Max: 4000})
	addFieldIfMissing(col, &core.TextField{Name: "execution_log", Max: 1 << 20})
	addFieldIfMissing(col, &core.BoolField{Name: "execution_log_truncated"})
	addFieldIfMissing(col, &core.DateField{Name: "started_at"})
	addFieldIfMissing(col, &core.DateField{Name: "ended_at"})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_workflow_node_runs_run", false, "workflow_run", "")
	col.AddIndex("idx_workflow_node_runs_status", false, "status", "")
	return app.Save(col)
}
