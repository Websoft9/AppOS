package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
)

func init() {
	m.Register(func(app core.App) error {
		_, err := ensurePipelineRunsCollection(app)
		return err
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("pipeline_runs")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}

func ensurePipelineRunsCollection(app core.App) (*core.Collection, error) {
	appOperations, err := ensureAppOperationsCollection(app)
	if err != nil {
		return nil, err
	}

	col, err := app.FindCollectionByNameOrId("pipeline_runs")
	if err != nil {
		col = core.NewBaseCollection("pipeline_runs")
	}

	col.ListRule = lifecycleAuthRule()
	col.ViewRule = lifecycleAuthRule()
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil

	addFieldIfMissing(col, &core.RelationField{Name: "operation", CollectionId: appOperations.Id, Required: true, MaxSelect: 1, CascadeDelete: true})
	addFieldIfMissing(col, &core.SelectField{Name: "pipeline_family", Required: true, MaxSelect: 1, Values: append([]string(nil), model.PipelineFamilies...)})
	addFieldIfMissing(col, &core.TextField{Name: "pipeline_definition_key", Required: true})
	addFieldIfMissing(col, &core.TextField{Name: "pipeline_version"})
	addFieldIfMissing(col, &core.SelectField{Name: "current_phase", Required: true, MaxSelect: 1, Values: append([]string(nil), model.PipelinePhases...)})
	addFieldIfMissing(col, &core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"active", "completed", "failed", "cancelled"}})
	addFieldIfMissing(col, &core.NumberField{Name: "node_count", Required: true, OnlyInt: true})
	addFieldIfMissing(col, &core.NumberField{Name: "completed_node_count", OnlyInt: true})
	addFieldIfMissing(col, &core.TextField{Name: "failed_node_key"})
	addFieldIfMissing(col, &core.DateField{Name: "started_at"})
	addFieldIfMissing(col, &core.DateField{Name: "ended_at"})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_pipeline_runs_operation", false, "`operation`", "")
	col.AddIndex("idx_pipeline_runs_status", false, "`status`", "")
	col.AddIndex("idx_pipeline_runs_started_at", false, "`started_at`", "")

	if err := app.Save(col); err != nil {
		return nil, err
	}
	if err := ensureAppOperationsRelationField(app, "pipeline_run", col); err != nil {
		return nil, err
	}
	return col, nil
}
