package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
)

func init() {
	m.Register(func(app core.App) error {
		_, err := ensurePipelineNodeRunsCollection(app)
		return err
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("pipeline_node_runs")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}

func ensurePipelineNodeRunsCollection(app core.App) (*core.Collection, error) {
	pipelineRuns, err := ensurePipelineRunsCollection(app)
	if err != nil {
		return nil, err
	}

	col, err := app.FindCollectionByNameOrId("pipeline_node_runs")
	if err != nil {
		col = core.NewBaseCollection("pipeline_node_runs")
	}

	col.ListRule = lifecycleAuthRule()
	col.ViewRule = lifecycleAuthRule()
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil

	addFieldIfMissing(col, &core.RelationField{Name: "pipeline_run", CollectionId: pipelineRuns.Id, Required: true, MaxSelect: 1, CascadeDelete: true})
	addFieldIfMissing(col, &core.TextField{Name: "node_key", Required: true})
	addFieldIfMissing(col, &core.TextField{Name: "node_type", Required: true})
	addFieldIfMissing(col, &core.TextField{Name: "display_name", Required: true})
	addFieldIfMissing(col, &core.SelectField{Name: "phase", Required: true, MaxSelect: 1, Values: append([]string(nil), model.PipelinePhases...)})
	addFieldIfMissing(col, &core.JSONField{Name: "depends_on_json"})
	addFieldIfMissing(col, &core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{"pending", "running", "succeeded", "failed", "skipped", "cancelled", "compensated"}})
	addFieldIfMissing(col, &core.NumberField{Name: "retry_count", OnlyInt: true})
	addFieldIfMissing(col, &core.TextField{Name: "compensation_node_key"})
	addFieldIfMissing(col, &core.TextField{Name: "error_code"})
	addFieldIfMissing(col, &core.TextField{Name: "error_message"})
	addFieldIfMissing(col, &core.TextField{Name: "execution_log"})
	addFieldIfMissing(col, &core.BoolField{Name: "execution_log_truncated"})
	addFieldIfMissing(col, &core.DateField{Name: "started_at"})
	addFieldIfMissing(col, &core.DateField{Name: "ended_at"})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_pipeline_node_runs_pipeline_run", false, "`pipeline_run`", "")
	col.AddIndex("idx_pipeline_node_runs_status", false, "`status`", "")
	col.AddIndex("idx_pipeline_node_runs_phase", false, "`phase`", "")

	if err := app.Save(col); err != nil {
		return nil, err
	}
	return col, nil
}
