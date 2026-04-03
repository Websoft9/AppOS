package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		scripts := core.NewBaseCollection("scripts")
		scripts.ListRule = types.Pointer("@request.auth.id != ''")
		scripts.ViewRule = types.Pointer("@request.auth.id != ''")
		scripts.CreateRule = nil
		scripts.UpdateRule = nil
		scripts.DeleteRule = nil

		scripts.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 200})
		scripts.Fields.Add(&core.SelectField{Name: "language", Required: true, MaxSelect: 1, Values: []string{"python3", "bash"}})
		scripts.Fields.Add(&core.TextField{Name: "code", Required: true})
		scripts.Fields.Add(&core.TextField{Name: "description"})
		scripts.AddIndex("idx_scripts_name", true, "name", "")

		return app.Save(scripts)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("scripts")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}