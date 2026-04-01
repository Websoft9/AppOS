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
		field, ok := col.Fields.GetByName("status").(*core.SelectField)
		if !ok || field == nil {
			return nil
		}
		field.Values = deploy.StatusValues()
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("deployments")
		if err != nil {
			return nil
		}
		field, ok := col.Fields.GetByName("status").(*core.SelectField)
		if !ok || field == nil {
			return nil
		}
		field.Values = []string{
			deploy.StatusQueued,
			deploy.StatusValidating,
			deploy.StatusRunning,
			deploy.StatusSuccess,
			deploy.StatusFailed,
			deploy.StatusRollingBack,
			deploy.StatusRolledBack,
		}
		return app.Save(col)
	})
}