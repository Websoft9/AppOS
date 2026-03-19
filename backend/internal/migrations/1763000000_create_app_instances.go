package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		col := core.NewBaseCollection("app_instances")

		authRule := types.Pointer("@request.auth.id != ''")
		col.ListRule = authRule
		col.ViewRule = authRule
		col.CreateRule = nil
		col.UpdateRule = nil
		col.DeleteRule = nil

		col.Fields.Add(&core.TextField{Name: "deployment_id"})
		col.Fields.Add(&core.TextField{Name: "server_id"})
		col.Fields.Add(&core.TextField{Name: "name", Required: true})
		col.Fields.Add(&core.TextField{Name: "project_dir", Required: true})
		col.Fields.Add(&core.TextField{Name: "source"})
		col.Fields.Add(&core.SelectField{
			Name:      "status",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"installed", "uninstalled"},
		})
		col.Fields.Add(&core.TextField{Name: "runtime_status"})
		col.Fields.Add(&core.TextField{Name: "runtime_reason"})
		col.Fields.Add(&core.TextField{Name: "last_deployment_status"})
		col.Fields.Add(&core.TextField{Name: "last_action"})
		col.Fields.Add(&core.DateField{Name: "last_action_at"})
		col.Fields.Add(&core.DateField{Name: "last_deployed_at"})
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		col.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

		col.Indexes = []string{
			"CREATE UNIQUE INDEX idx_app_instances_server_project ON app_instances (server_id, project_dir)",
			"CREATE INDEX idx_app_instances_status ON app_instances (status)",
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("app_instances")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}