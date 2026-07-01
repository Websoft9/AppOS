package schema

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

func EnsureDatabasesCollection(app core.App) error {
	secrets, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		return err
	}
	col, err := app.FindCollectionByNameOrId("databases")
	if err != nil {
		col = core.NewBaseCollection("databases")
	}
	col.ListRule = authenticatedRule()
	col.ViewRule = authenticatedRule()
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true, Max: 200})
	addFieldIfMissing(col, &core.SelectField{Name: "type", Required: true, MaxSelect: 1, Values: []string{"mysql", "postgres", "redis", "mongodb"}})
	addFieldIfMissing(col, &core.TextField{Name: "host"})
	addFieldIfMissing(col, &core.NumberField{Name: "port", OnlyInt: true, Min: types.Pointer(1.0), Max: types.Pointer(65535.0)})
	addFieldIfMissing(col, &core.TextField{Name: "db_name"})
	addFieldIfMissing(col, &core.TextField{Name: "user"})
	addFieldIfMissing(col, &core.RelationField{Name: "password", CollectionId: secrets.Id, MaxSelect: 1})
	addFieldIfMissing(col, &core.TextField{Name: "description"})
	col.AddIndex("idx_databases_name", true, "name", "")
	return app.Save(col)
}
