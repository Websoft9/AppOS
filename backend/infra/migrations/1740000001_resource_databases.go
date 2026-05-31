package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		secrets, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return err
		}

		col := core.NewBaseCollection("databases")
		col.ListRule = types.Pointer("@request.auth.id != ''")
		col.ViewRule = types.Pointer("@request.auth.id != ''")
		col.CreateRule = nil
		col.UpdateRule = nil
		col.DeleteRule = nil

		col.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 200})
		col.Fields.Add(&core.SelectField{Name: "type", Required: true, MaxSelect: 1, Values: []string{"mysql", "postgres", "redis", "mongodb"}})
		col.Fields.Add(&core.TextField{Name: "host"})
		col.Fields.Add(&core.NumberField{Name: "port", OnlyInt: true, Min: types.Pointer(1.0), Max: types.Pointer(65535.0)})
		col.Fields.Add(&core.TextField{Name: "db_name"})
		col.Fields.Add(&core.TextField{Name: "user"})
		col.Fields.Add(&core.RelationField{Name: "password", CollectionId: secrets.Id, MaxSelect: 1})
		col.Fields.Add(&core.TextField{Name: "description"})
		col.AddIndex("idx_databases_name", true, "name", "")

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("databases")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}
