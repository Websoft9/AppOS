package schema

import "github.com/pocketbase/pocketbase/core"

func EnsureAppsCollection(app core.App) error {
	serversCol, err := app.FindCollectionByNameOrId("servers")
	if err != nil {
		return err
	}
	secretsCol, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		return err
	}
	databasesCol, err := app.FindCollectionByNameOrId("databases")
	if err != nil {
		return err
	}
	cloudAccountsCol, err := app.FindCollectionByNameOrId("cloud_accounts")
	if err != nil {
		return err
	}
	certificatesCol, err := app.FindCollectionByNameOrId("certificates")
	if err != nil {
		return err
	}
	col, err := app.FindCollectionByNameOrId("apps")
	if err != nil {
		col = core.NewBaseCollection("apps")
	}
	col.ListRule = nil
	col.ViewRule = nil
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	removeFieldIfExists(col, "env_groups")
	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true, Max: 200})
	addFieldIfMissing(col, &core.JSONField{Name: "env_vars", MaxSize: 102400})
	addFieldIfMissing(col, &core.JSONField{Name: "credentials", MaxSize: 102400, Hidden: true})
	addFieldIfMissing(col, &core.RelationField{Name: "server", CollectionId: serversCol.Id, MaxSelect: 1})
	addFieldIfMissing(col, &core.RelationField{Name: "secrets", CollectionId: secretsCol.Id, MaxSelect: 100})
	addFieldIfMissing(col, &core.RelationField{Name: "databases", CollectionId: databasesCol.Id, MaxSelect: 100})
	addFieldIfMissing(col, &core.RelationField{Name: "cloud_accounts", CollectionId: cloudAccountsCol.Id, MaxSelect: 100})
	addFieldIfMissing(col, &core.RelationField{Name: "certificates", CollectionId: certificatesCol.Id, MaxSelect: 100})
	col.AddIndex("idx_apps_name", true, "name", "")
	return app.Save(col)
}
