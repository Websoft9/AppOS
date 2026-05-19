package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/domain/software"
	"github.com/websoft9/appos/backend/infra/collections"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.DockerImagePullOperations)
		if err != nil {
			return nil
		}
		field, ok := col.Fields.GetByName("terminal_status").(*core.SelectField)
		if !ok || field == nil {
			return nil
		}
		for _, value := range field.Values {
			if value == string(software.TerminalStatusCancelled) {
				return nil
			}
		}
		field.Values = append(field.Values, string(software.TerminalStatusCancelled))
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.DockerImagePullOperations)
		if err != nil {
			return nil
		}
		field, ok := col.Fields.GetByName("terminal_status").(*core.SelectField)
		if !ok || field == nil {
			return nil
		}
		filtered := make([]string, 0, len(field.Values))
		for _, value := range field.Values {
			if value != string(software.TerminalStatusCancelled) {
				filtered = append(filtered, value)
			}
		}
		field.Values = filtered
		return app.Save(col)
	})
}