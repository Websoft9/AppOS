package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		_, err := ensureAppExposuresCollection(app)
		return err
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("app_exposures")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}

func ensureAppExposuresCollection(app core.App) (*core.Collection, error) {
	appInstances, err := ensureAppInstancesCollection(app)
	if err != nil {
		return nil, err
	}
	appReleases, err := ensureAppReleasesCollection(app)
	if err != nil {
		return nil, err
	}
	certificatesCol, err := app.FindCollectionByNameOrId("certificates")
	if err != nil {
		return nil, err
	}

	col, err := app.FindCollectionByNameOrId("app_exposures")
	if err != nil {
		col = core.NewBaseCollection("app_exposures")
	}

	col.ListRule = lifecycleAuthRule()
	col.ViewRule = lifecycleAuthRule()
	col.CreateRule = lifecycleAuthRule()
	col.UpdateRule = lifecycleAuthRule()
	col.DeleteRule = nil

	addFieldIfMissing(col, &core.RelationField{Name: "app", CollectionId: appInstances.Id, Required: true, MaxSelect: 1, CascadeDelete: true})
	addFieldIfMissing(col, &core.RelationField{Name: "release", CollectionId: appReleases.Id, MaxSelect: 1})
	addFieldIfMissing(col, &core.SelectField{Name: "exposure_type", Required: true, MaxSelect: 1, Values: []string{"domain", "path", "port", "internal_only"}})
	addFieldIfMissing(col, &core.BoolField{Name: "is_primary"})
	addFieldIfMissing(col, &core.TextField{Name: "domain"})
	addFieldIfMissing(col, &core.TextField{Name: "path"})
	addFieldIfMissing(col, &core.NumberField{Name: "target_port", OnlyInt: true})
	addFieldIfMissing(col, &core.RelationField{Name: "certificate", CollectionId: certificatesCol.Id, MaxSelect: 1})
	addFieldIfMissing(col, &core.SelectField{Name: "publication_state", Required: true, MaxSelect: 1, Values: []string{"unpublished", "publishing", "published", "published_degraded", "unpublishing", "publication_failed", "publication_attention_required"}})
	addFieldIfMissing(col, &core.SelectField{Name: "health_state", Required: true, MaxSelect: 1, Values: []string{"healthy", "degraded", "unknown"}})
	addFieldIfMissing(col, &core.DateField{Name: "last_verified_at"})
	addFieldIfMissing(col, &core.DateField{Name: "disabled_at"})
	addFieldIfMissing(col, &core.TextField{Name: "notes"})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_app_exposures_app", false, "`app`", "")
	col.AddIndex("idx_app_exposures_publication_state", false, "`publication_state`", "")
	col.AddIndex("idx_app_exposures_domain", false, "`domain`", "")

	if err := app.Save(col); err != nil {
		return nil, err
	}
	if err := ensureAppInstanceRelationField(app, "primary_exposure", col); err != nil {
		return nil, err
	}
	return col, nil
}