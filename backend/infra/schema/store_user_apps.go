package schema

import "github.com/pocketbase/pocketbase/core"

func EnsureStoreUserAppsCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId("store_user_apps")
	if err != nil {
		col = core.NewBaseCollection("store_user_apps")
	}
	rule := "user = @request.auth.id"
	col.ListRule = &rule
	col.ViewRule = &rule
	col.CreateRule = &rule
	col.UpdateRule = &rule
	col.DeleteRule = &rule
	addFieldIfMissing(col, &core.TextField{Name: "user", Required: true, Max: 64})
	addFieldIfMissing(col, &core.TextField{Name: "app_key", Required: true, Max: 255})
	addFieldIfMissing(col, &core.BoolField{Name: "is_favorite"})
	addFieldIfMissing(col, &core.TextField{Name: "note", Max: 10000})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_store_user_apps_user_app", true, "user, app_key", "")
	return app.Save(col)
}
