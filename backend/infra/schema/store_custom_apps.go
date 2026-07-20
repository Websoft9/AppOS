package schema

import "github.com/pocketbase/pocketbase/core"

func EnsureStoreCustomAppsCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId("store_custom_apps")
	if err != nil {
		col = core.NewBaseCollection("store_custom_apps")
	}
	listView := `visibility = "shared" || created_by = @request.auth.id`
	create := "@request.auth.id != ''"
	ownerOnly := "created_by = @request.auth.id"
	col.ListRule = &listView
	col.ViewRule = &listView
	col.CreateRule = &create
	col.UpdateRule = &ownerOnly
	col.DeleteRule = &ownerOnly
	addFieldIfMissing(col, &core.TextField{Name: "key", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "trademark", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "logo_url", Max: 500})
	addFieldIfMissing(col, &core.TextField{Name: "overview", Required: true, Max: 500})
	addFieldIfMissing(col, &core.TextField{Name: "description", Max: 50000})
	addFieldIfMissing(col, &core.JSONField{Name: "category_keys"})
	addFieldIfMissing(col, &core.TextField{Name: "compose_yaml", Max: 100000})
	addFieldIfMissing(col, &core.TextField{Name: "env_text", Max: 100000})
	addFieldIfMissing(col, &core.SelectField{Name: "visibility", Required: true, MaxSelect: 1, Values: []string{"private", "shared"}})
	addFieldIfMissing(col, &core.TextField{Name: "created_by", Required: true, Max: 100})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_store_custom_apps_key", true, "key", "")
	return app.Save(col)
}
