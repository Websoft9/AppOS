package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("audit_logs")
		if err != nil {
			return nil
		}
		field, ok := col.Fields.GetByName("status").(*core.SelectField)
		if !ok {
			return nil
		}
		field.Values = []string{"pending", "success", "failed", "attention_required"}
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("audit_logs")
		if err != nil {
			return nil
		}
		field, ok := col.Fields.GetByName("status").(*core.SelectField)
		if !ok {
			return nil
		}
		field.Values = []string{"pending", "success", "failed"}
		return app.Save(col)
	})
}
