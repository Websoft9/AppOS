package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
)

func init() {
	m.Register(func(app core.App) error {
		_, err := ensureAppInstancesCollection(app)
		return err
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("app_instances")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}

func lifecycleAuthRule() *string {
	return types.Pointer("@request.auth.id != ''")
}

func ensureAppInstancesCollection(app core.App) (*core.Collection, error) {
	col, err := app.FindCollectionByNameOrId("app_instances")
	if err != nil {
		col = core.NewBaseCollection("app_instances")
	}

	col.ListRule = lifecycleAuthRule()
	col.ViewRule = lifecycleAuthRule()
	col.CreateRule = lifecycleAuthRule()
	col.UpdateRule = lifecycleAuthRule()
	col.DeleteRule = nil

	addFieldIfMissing(col, &core.TextField{Name: "key", Required: true})
	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true})
	addFieldIfMissing(col, &core.TextField{Name: "template_key"})
	addFieldIfMissing(col, &core.TextField{Name: "server_id", Required: true})
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

	if err := app.Save(col); err != nil {
		return nil, err
	}
	return col, nil
}

func ensureAppInstanceRelationField(app core.App, fieldName string, target *core.Collection) error {
	col, err := ensureAppInstancesCollection(app)
	if err != nil {
		return err
	}
	addFieldIfMissing(col, &core.RelationField{Name: fieldName, CollectionId: target.Id, MaxSelect: 1})
	return app.Save(col)
}
