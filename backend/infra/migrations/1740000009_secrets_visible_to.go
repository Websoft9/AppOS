package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	secretdomain "github.com/websoft9/appos/backend/domain/secrets"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return err
		}

		addFieldIfMissing(col, &core.SelectField{
			Name:      "visible_to",
			Values:    append([]string(nil), secretdomain.VisibleToValues...),
			MaxSelect: len(secretdomain.VisibleToValues),
		})

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return nil
		}

		if field := col.Fields.GetByName("visible_to"); field != nil {
			col.Fields.RemoveByName("visible_to")
		}

		return app.Save(col)
	})
}