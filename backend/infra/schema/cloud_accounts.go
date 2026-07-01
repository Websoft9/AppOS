package schema

import "github.com/pocketbase/pocketbase/core"

func EnsureCloudAccountsCollection(app core.App) error {
	secrets, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		return err
	}
	col, err := app.FindCollectionByNameOrId("cloud_accounts")
	if err != nil {
		col = core.NewBaseCollection("cloud_accounts")
	}
	col.ListRule = authenticatedRule()
	col.ViewRule = authenticatedRule()
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true, Max: 200})
	addFieldIfMissing(col, &core.SelectField{Name: "provider", Required: true, MaxSelect: 1, Values: []string{"aws", "aliyun", "azure", "gcp"}})
	addFieldIfMissing(col, &core.TextField{Name: "access_key_id"})
	addFieldIfMissing(col, &core.RelationField{Name: "secret", CollectionId: secrets.Id, MaxSelect: 1})
	addFieldIfMissing(col, &core.TextField{Name: "region"})
	addFieldIfMissing(col, &core.JSONField{Name: "extra", MaxSize: 1 << 20})
	addFieldIfMissing(col, &core.TextField{Name: "description"})
	col.AddIndex("idx_cloud_accounts_name", true, "name", "")
	return app.Save(col)
}
