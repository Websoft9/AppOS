package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/domain/deploy"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("deployments")
		if err != nil {
			return nil
		}

		addFieldIfMissing(col, &core.TextField{Name: "current_step"})
		addFieldIfMissing(col, &core.SelectField{Name: "step_status", MaxSelect: 1, Values: deploy.StepStatusValues()})
		addFieldIfMissing(col, &core.JSONField{Name: "last_error"})
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("deployments")
		if err != nil {
			return nil
		}

		col.Fields.RemoveByName("current_step")
		col.Fields.RemoveByName("step_status")
		col.Fields.RemoveByName("last_error")
		return app.Save(col)
	})
}