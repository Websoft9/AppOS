package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Story 5.5: Create store_custom_apps collection for user-defined app definitions.
//
// Visibility: private (owner-only) or shared (all authenticated users can view).
// created_by: TextField storing auth record ID (supports both users and _superusers).
//
// Access rules:
//   - List/View: own apps OR shared apps
//   - Create: any authenticated user
//   - Update/Delete: only creator
func init() {
	m.Register(func(app core.App) error {
		col := core.NewBaseCollection("store_custom_apps")

		col.Fields.Add(&core.TextField{Name: "key", Required: true, Max: 200})
		col.Fields.Add(&core.TextField{Name: "trademark", Required: true, Max: 200})
		col.Fields.Add(&core.TextField{Name: "logo_url", Max: 500})
		col.Fields.Add(&core.TextField{Name: "overview", Required: true, Max: 500})
		col.Fields.Add(&core.TextField{Name: "description", Max: 50000})
		col.Fields.Add(&core.JSONField{Name: "category_keys"})
		col.Fields.Add(&core.TextField{Name: "compose_yaml", Max: 100000})
		col.Fields.Add(&core.TextField{Name: "env_text", Max: 100000})
		col.Fields.Add(&core.SelectField{
			Name:      "visibility",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"private", "shared"},
		})
		col.Fields.Add(&core.TextField{Name: "created_by", Required: true, Max: 100})
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		col.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

		listView := `visibility = "shared" || created_by = @request.auth.id`
		create := "@request.auth.id != \"\""
		ownerOnly := "created_by = @request.auth.id"

		col.ListRule = &listView
		col.ViewRule = &listView
		col.CreateRule = &create
		col.UpdateRule = &ownerOnly
		col.DeleteRule = &ownerOnly

		col.Indexes = []string{
			"CREATE UNIQUE INDEX idx_store_custom_apps_key ON store_custom_apps (key)",
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("store_custom_apps")
		if err != nil {
			return nil // already gone
		}
		return app.Delete(col)
	})
}
