package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Story 11.4: Add name (TextField) and avatar (FileField) to the `users` collection.
// Superusers (_superusers) do not get these fields.
func init() {
	m.Register(func(app core.App) error {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		// Add `name` text field if not present
		if users.Fields.GetByName("name") == nil {
			users.Fields.Add(&core.TextField{
				Name:     "name",
				Required: false,
				Max:      200,
			})
		}

		// Add `avatar` file field if not present
		if users.Fields.GetByName("avatar") == nil {
			users.Fields.Add(&core.FileField{
				Name:      "avatar",
				MaxSelect: 1,
				MaxSize:   5242880, // 5 MB
				MimeTypes: []string{"image/jpeg", "image/png", "image/gif", "image/webp"},
				Protected: false,
			})
		}

		return app.Save(users)
	}, func(app core.App) error {
		// Down: remove name and avatar from users collection
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		users.Fields.RemoveByName("name")
		users.Fields.RemoveByName("avatar")
		return app.Save(users)
	})
}
