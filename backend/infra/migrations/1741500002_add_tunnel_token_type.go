package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Story 16.2: Add "tunnel_token" to the secrets type select field so that
// tunnel tokens can be distinguished from regular credentials.
func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return err
		}

		typeField := col.Fields.GetByName("type")
		if typeField == nil {
			return nil // field disappeared — nothing to do
		}

		sf, ok := typeField.(*core.SelectField)
		if !ok {
			return nil
		}

		// Add "tunnel_token" if not already present.
		for _, v := range sf.Values {
			if v == "tunnel_token" {
				return nil // already exists
			}
		}
		sf.Values = append(sf.Values, "tunnel_token")

		return app.Save(col)
	}, func(app core.App) error {
		// Down migration: optional — leave the value in the list.
		return nil
	})
}
