package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		secretsCol, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return err
		}

		endpoints := core.NewBaseCollection("endpoints")
		endpoints.ListRule = types.Pointer("@request.auth.id != ''")
		endpoints.ViewRule = types.Pointer("@request.auth.id != ''")
		endpoints.CreateRule = nil
		endpoints.UpdateRule = nil
		endpoints.DeleteRule = nil

		endpoints.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 200})
		endpoints.Fields.Add(&core.SelectField{Name: "type", Required: true, MaxSelect: 1, Values: []string{"rest", "webhook", "mcp"}})
		endpoints.Fields.Add(&core.TextField{Name: "url", Required: true})
		endpoints.Fields.Add(&core.SelectField{Name: "auth_type", Required: true, MaxSelect: 1, Values: []string{"none", "api_key", "bearer", "basic"}})
		endpoints.Fields.Add(&core.RelationField{Name: "credential", CollectionId: secretsCol.Id, MaxSelect: 1})
		endpoints.Fields.Add(&core.JSONField{Name: "extra", MaxSize: 1 << 20})
		endpoints.Fields.Add(&core.TextField{Name: "description"})
		endpoints.AddIndex("idx_endpoints_name", true, "name", "")

		return app.Save(endpoints)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("endpoints")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}