package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
)

func init() {
	m.Register(func(app core.App) error {
		_, err := ensureAppOperationsCollection(app)
		return err
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("app_operations")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}

func ensureAppOperationsCollection(app core.App) (*core.Collection, error) {
	appInstances, err := ensureAppInstancesCollection(app)
	if err != nil {
		return nil, err
	}
	usersCol, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return nil, err
	}

	col, err := app.FindCollectionByNameOrId("app_operations")
	if err != nil {
		col = core.NewBaseCollection("app_operations")
	}

	col.ListRule = lifecycleAuthRule()
	col.ViewRule = lifecycleAuthRule()
	col.CreateRule = lifecycleAuthRule()
	col.UpdateRule = nil
	col.DeleteRule = nil

	addFieldIfMissing(col, &core.RelationField{Name: "app", CollectionId: appInstances.Id, Required: true, MaxSelect: 1})
	addFieldIfMissing(col, &core.TextField{Name: "server_id", Required: true})
	addFieldIfMissing(col, &core.SelectField{Name: "operation_type", Required: true, MaxSelect: 1, Values: append([]string(nil), model.OperationTypes...)})
	addFieldIfMissing(col, &core.SelectField{Name: "trigger_source", Required: true, MaxSelect: 1, Values: []string{"manualops", "fileops", "gitops", "store", "system"}})
	addFieldIfMissing(col, &core.TextField{Name: "adapter"})
	addFieldIfMissing(col, &core.RelationField{Name: "requested_by", CollectionId: usersCol.Id, MaxSelect: 1})
	addFieldIfMissing(col, &core.SelectField{Name: "phase", Required: true, MaxSelect: 1, Values: append([]string(nil), model.OperationPhases...)})
	addFieldIfMissing(col, &core.SelectField{Name: "terminal_status", MaxSelect: 1, Values: []string{"success", "failed", "cancelled", "compensated", "manual_intervention_required"}})
	addFieldIfMissing(col, &core.SelectField{Name: "failure_reason", MaxSelect: 1, Values: []string{"timeout", "validation_error", "resource_conflict", "dependency_unavailable", "execution_error", "verification_failed", "compensation_failed", "unknown"}})
	addFieldIfMissing(col, &core.SelectField{Name: "app_outcome", MaxSelect: 1, Values: []string{"new_release_active", "previous_release_active", "no_healthy_release", "state_unknown"}})
	addFieldIfMissing(col, &core.JSONField{Name: "spec_json"})
	addFieldIfMissing(col, &core.TextField{Name: "compose_project_name"})
	addFieldIfMissing(col, &core.TextField{Name: "project_dir"})
	addFieldIfMissing(col, &core.TextField{Name: "rendered_compose"})
	addFieldIfMissing(col, &core.JSONField{Name: "resolved_env_json"})
	addFieldIfMissing(col, &core.TextField{Name: "execution_log"})
	addFieldIfMissing(col, &core.BoolField{Name: "execution_log_truncated"})
	addFieldIfMissing(col, &core.JSONField{Name: "log_cursor"})
	addFieldIfMissing(col, &core.TextField{Name: "error_message"})
	addFieldIfMissing(col, &core.DateField{Name: "queued_at", Required: true})
	addFieldIfMissing(col, &core.DateField{Name: "started_at"})
	addFieldIfMissing(col, &core.DateField{Name: "ended_at"})
	addFieldIfMissing(col, &core.DateField{Name: "cancel_requested_at"})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_app_operations_app", false, "`app`", "")
	col.AddIndex("idx_app_operations_server_id", false, "`server_id`", "")
	col.AddIndex("idx_app_operations_phase", false, "`phase`", "")
	col.AddIndex("idx_app_operations_terminal_status", false, "`terminal_status`", "")
	col.AddIndex("idx_app_operations_operation_type", false, "`operation_type`", "")
	col.AddIndex("idx_app_operations_queued_at", false, "`queued_at`", "")
	col.AddIndex("idx_app_operations_server_phase", false, "`server_id`, `phase`", "")

	if err := app.Save(col); err != nil {
		return nil, err
	}
	if err := ensureAppInstanceRelationField(app, "last_operation", col); err != nil {
		return nil, err
	}
	return col, nil
}

func ensureAppOperationsRelationField(app core.App, fieldName string, target *core.Collection) error {
	col, err := ensureAppOperationsCollection(app)
	if err != nil {
		return err
	}
	addFieldIfMissing(col, &core.RelationField{Name: fieldName, CollectionId: target.Id, MaxSelect: 1})
	return app.Save(col)
}