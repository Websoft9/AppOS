package schema

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
)

func EnsureAppInstancesCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId("app_instances")
	if err != nil {
		col = core.NewBaseCollection("app_instances")
	}
	col.ListRule = lifecycleAuthRule()
	col.ViewRule = lifecycleAuthRule()
	col.CreateRule = lifecycleAuthRule()
	col.UpdateRule = lifecycleAuthRule()
	col.DeleteRule = nil
	removeFieldIfExists(col, "source_type")
	addFieldIfMissing(col, &core.TextField{Name: "key", Required: true})
	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true})
	addFieldIfMissing(col, &core.TextField{Name: "template_key"})
	addFieldIfMissing(col, &core.TextField{Name: "server_id", Required: true})
	addFieldIfMissing(col, &core.SelectField{Name: "channel", MaxSelect: 1, Values: append([]string(nil), model.OperationChannels...)})
	addFieldIfMissing(col, &core.SelectField{Name: "lifecycle_state", Required: true, MaxSelect: 1, Values: append([]string(nil), model.AppLifecycleStates...)})
	addFieldIfMissing(col, &core.SelectField{Name: "desired_state", MaxSelect: 1, Values: append([]string(nil), model.DesiredAppStates...)})
	addFieldIfMissing(col, &core.SelectField{Name: "health_summary", Required: true, MaxSelect: 1, Values: append([]string(nil), model.HealthSummaries...)})
	addFieldIfMissing(col, &core.SelectField{Name: "publication_summary", MaxSelect: 1, Values: append([]string(nil), model.PublicationSummaries...)})
	addFieldIfMissing(col, &core.DateField{Name: "installed_at"})
	addFieldIfMissing(col, &core.DateField{Name: "last_healthy_at"})
	addFieldIfMissing(col, &core.DateField{Name: "retired_at"})
	addFieldIfMissing(col, &core.TextField{Name: "state_reason"})
	addFieldIfMissing(col, &core.TextField{Name: "access_username"})
	addFieldIfMissing(col, &core.TextField{Name: "access_secret_hint"})
	addFieldIfMissing(col, &core.TextField{Name: "access_retrieval_method"})
	addFieldIfMissing(col, &core.TextField{Name: "access_notes"})
	addFieldIfMissing(col, &core.JSONField{Name: "access_endpoints", MaxSize: 1 << 20})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_app_instances_key", true, "`key`", "")
	col.AddIndex("idx_app_instances_server_id", false, "`server_id`", "")
	col.AddIndex("idx_app_instances_lifecycle_state", false, "`lifecycle_state`", "")
	col.AddIndex("idx_app_instances_server_lifecycle", false, "`server_id`, `lifecycle_state`", "")
	return app.Save(col)
}

func ensureAppInstanceRelationField(app core.App, fieldName string, target *core.Collection) error {
	col, err := app.FindCollectionByNameOrId("app_instances")
	if err != nil {
		return err
	}
	addFieldIfMissing(col, &core.RelationField{Name: fieldName, CollectionId: target.Id, MaxSelect: 1})
	return app.Save(col)
}
