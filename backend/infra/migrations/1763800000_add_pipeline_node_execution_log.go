package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("pipeline_node_runs")
		if err != nil {
			return err
		}

		if col.Fields.GetByName("execution_log") == nil {
			col.Fields.Add(&core.TextField{Name: "execution_log"})
		}
		if col.Fields.GetByName("execution_log_truncated") == nil {
			col.Fields.Add(&core.BoolField{Name: "execution_log_truncated"})
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("pipeline_node_runs")
		if err != nil {
			return nil
		}

		col.Fields.RemoveByName("execution_log")
		col.Fields.RemoveByName("execution_log_truncated")
		return app.Save(col)
	})
}
