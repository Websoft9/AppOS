package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Add created_source to secrets so system-generated credentials can be
// distinguished from user-generated credentials.
func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return err
		}

		if col.Fields.GetByName("created_source") == nil {
			col.Fields.Add(&core.SelectField{
				Name:     "created_source",
				Required: false,
				Values:   []string{"user", "system"},
			})
		}

		if err := app.Save(col); err != nil {
			return err
		}

		records, err := app.FindRecordsByFilter("secrets", "", "", 0, 0)
		if err != nil {
			return err
		}

		for _, rec := range records {
			if rec.GetString("created_source") != "" {
				continue
			}
			if rec.GetString("type") == "tunnel_token" {
				rec.Set("created_source", "system")
			} else {
				rec.Set("created_source", "user")
			}
			if err := app.Save(rec); err != nil {
				return err
			}
		}

		return nil
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return err
		}

		if field := col.Fields.GetByName("created_source"); field != nil {
			col.Fields.RemoveById(field.GetId())
		}

		return app.Save(col)
	})
}
