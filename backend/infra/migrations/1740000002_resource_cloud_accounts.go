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

		col := core.NewBaseCollection("cloud_accounts")
		col.ListRule = types.Pointer("@request.auth.id != ''")
		col.ViewRule = types.Pointer("@request.auth.id != ''")
		col.CreateRule = nil
		col.UpdateRule = nil
		col.DeleteRule = nil

		col.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 200})
		col.Fields.Add(&core.SelectField{Name: "provider", Required: true, MaxSelect: 1, Values: []string{"aws", "aliyun", "azure", "gcp"}})
		col.Fields.Add(&core.TextField{Name: "access_key_id"})
		col.Fields.Add(&core.RelationField{Name: "secret", CollectionId: secrets.Id, MaxSelect: 1})
		col.Fields.Add(&core.TextField{Name: "region"})
		col.Fields.Add(&core.JSONField{Name: "extra", MaxSize: 1 << 20})
		col.Fields.Add(&core.TextField{Name: "description"})
		col.AddIndex("idx_cloud_accounts_name", true, "name", "")

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("cloud_accounts")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}