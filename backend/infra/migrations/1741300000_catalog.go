package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	registerCatalogUserAppsMigration()
	registerCatalogCustomAppsMigration()
	registerCatalogCustomAppsEnvTextMigration()
}

// registerCatalogUserAppsMigration preserves the original migration identity
// for per-user catalog favorites and notes.
func registerCatalogUserAppsMigration() {
	m.Register(func(app core.App) error {
		col := core.NewBaseCollection("store_user_apps")

		col.Fields.Add(&core.TextField{Name: "user", Required: true, Max: 64})
		col.Fields.Add(&core.TextField{Name: "app_key", Required: true, Max: 255})
		col.Fields.Add(&core.BoolField{Name: "is_favorite"})
		col.Fields.Add(&core.TextField{Name: "note", Max: 10000})
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		col.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

		rule := "user = @request.auth.id"
		col.ListRule = &rule
		col.ViewRule = &rule
		col.CreateRule = &rule
		col.UpdateRule = &rule
		col.DeleteRule = &rule

		col.Indexes = []string{
			"CREATE UNIQUE INDEX idx_store_user_apps_user_app ON store_user_apps (user, app_key)",
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("store_user_apps")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	}, "1741300000_create_store_user_apps.go")
}

// registerCatalogCustomAppsMigration preserves the original migration identity
// for the custom catalog app collection creation.
func registerCatalogCustomAppsMigration() {
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
			return nil
		}
		return app.Delete(col)
	}, "1741300001_create_store_custom_apps.go")
}

// registerCatalogCustomAppsEnvTextMigration preserves the original additive
// migration identity while making the operation idempotent for fresh installs.
func registerCatalogCustomAppsEnvTextMigration() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("store_custom_apps")
		if err != nil {
			return err
		}

		if col.Fields.GetByName("env_text") == nil {
			col.Fields.Add(&core.TextField{
				Name:     "env_text",
				Required: false,
			})
		}

		return app.Save(col)
	}, func(app core.App) error {
		return nil
	}, "1741300002_add_env_to_custom_apps.go")
}