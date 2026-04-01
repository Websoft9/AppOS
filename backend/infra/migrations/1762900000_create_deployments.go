package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/deploy"
)

// Epic 17: create deployments collection for async deploy lifecycle tracking.
func init() {
	m.Register(func(app core.App) error {
		col := core.NewBaseCollection("deployments")

		authRule := types.Pointer("@request.auth.id != ''")
		col.ListRule = authRule
		col.ViewRule = authRule
		col.CreateRule = nil
		col.UpdateRule = nil
		col.DeleteRule = nil

		col.Fields.Add(&core.TextField{Name: "server_id"})
		col.Fields.Add(&core.SelectField{
			Name:      "source",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"manualops", "fileops", "gitops", "store"},
		})
		col.Fields.Add(&core.SelectField{
			Name:      "status",
			Required:  true,
			MaxSelect: 1,
			Values:    deploy.StatusValues(),
		})
		col.Fields.Add(&core.TextField{Name: "adapter"})
		col.Fields.Add(&core.TextField{Name: "compose_project_name"})
		col.Fields.Add(&core.TextField{Name: "project_dir"})
		col.Fields.Add(&core.JSONField{Name: "spec"})
		col.Fields.Add(&core.TextField{Name: "rendered_compose"})
		col.Fields.Add(&core.TextField{Name: "execution_log"})
		col.Fields.Add(&core.BoolField{Name: "execution_log_truncated"})
		col.Fields.Add(&core.TextField{Name: "error_summary"})
		col.Fields.Add(&core.JSONField{Name: "release_snapshot"})
		col.Fields.Add(&core.DateField{Name: "started_at"})
		col.Fields.Add(&core.DateField{Name: "finished_at"})
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		col.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

		col.Indexes = []string{
			"CREATE INDEX idx_deployments_status ON deployments (status)",
			"CREATE INDEX idx_deployments_server_id ON deployments (server_id)",
			"CREATE INDEX idx_deployments_source ON deployments (source)",
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("deployments")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}