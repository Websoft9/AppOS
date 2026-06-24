package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
)

func init() {
	m.Register(func(app core.App) error {
		_, err := ensureAppReleasesCollection(app)
		return err
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("app_releases")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}

func ensureAppReleasesCollection(app core.App) (*core.Collection, error) {
	appInstances, err := ensureAppInstancesCollection(app)
	if err != nil {
		return nil, err
	}
	appOperations, err := ensureAppOperationsCollection(app)
	if err != nil {
		return nil, err
	}

	col, err := app.FindCollectionByNameOrId("app_releases")
	if err != nil {
		col = core.NewBaseCollection("app_releases")
	}

	col.ListRule = lifecycleAuthRule()
	col.ViewRule = lifecycleAuthRule()
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil

	addFieldIfMissing(col, &core.RelationField{Name: "app", CollectionId: appInstances.Id, Required: true, MaxSelect: 1, CascadeDelete: true})
	addFieldIfMissing(col, &core.RelationField{Name: "created_by_operation", CollectionId: appOperations.Id, MaxSelect: 1})
	addFieldIfMissing(col, &core.SelectField{Name: "release_role", Required: true, MaxSelect: 1, Values: []string{"candidate", "active", "last_known_good", "historical"}})
	addFieldIfMissing(col, &core.TextField{Name: "version_label"})
	removeFieldIfExists(col, "source_type")
	addFieldIfMissing(col, &core.SelectField{Name: "channel", Required: true, MaxSelect: 1, Values: append([]string(nil), model.OperationChannels...)})
	addFieldIfMissing(col, &core.TextField{Name: "source_ref"})
	addFieldIfMissing(col, &core.TextField{Name: "rendered_compose", Required: true})
	addFieldIfMissing(col, &core.JSONField{Name: "resolved_env_json"})
	addFieldIfMissing(col, &core.TextField{Name: "config_digest"})
	addFieldIfMissing(col, &core.TextField{Name: "artifact_digest"})
	addFieldIfMissing(col, &core.BoolField{Name: "is_active"})
	addFieldIfMissing(col, &core.BoolField{Name: "is_last_known_good"})
	addFieldIfMissing(col, &core.DateField{Name: "activated_at"})
	addFieldIfMissing(col, &core.DateField{Name: "superseded_at"})
	addFieldIfMissing(col, &core.TextField{Name: "notes"})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_app_releases_app", false, "`app`", "")
	col.AddIndex("idx_app_releases_is_active", false, "`is_active`", "")
	col.AddIndex("idx_app_releases_is_last_known_good", false, "`is_last_known_good`", "")
	col.AddIndex("idx_app_releases_activated_at", false, "`activated_at`", "")

	if err := app.Save(col); err != nil {
		return nil, err
	}
	if err := ensureAppInstanceRelationField(app, "current_release", col); err != nil {
		return nil, err
	}
	for _, fieldName := range []string{"baseline_release", "candidate_release", "result_release"} {
		if err := ensureAppOperationsRelationField(app, fieldName, col); err != nil {
			return nil, err
		}
	}
	return col, nil
}
