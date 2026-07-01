package schema

import "github.com/pocketbase/pocketbase/core"

func EnsureUsersCollectionPatch(app core.App) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	addFieldIfMissing(users, &core.TextField{Name: "name", Max: 200})
	addFieldIfMissing(users, &core.FileField{
		Name:      "avatar",
		MaxSelect: 1,
		MaxSize:   5242880,
		MimeTypes: []string{"image/jpeg", "image/png", "image/gif", "image/webp"},
	})
	return app.Save(users)
}
