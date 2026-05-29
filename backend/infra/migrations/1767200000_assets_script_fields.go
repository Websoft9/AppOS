package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/domain/assets"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(assets.Collection)
		if err != nil {
			return err
		}

		if col.Fields.GetByName("language") == nil {
			col.Fields.Add(&core.SelectField{Name: "language", MaxSelect: 1, Values: assets.SupportedLanguages})
		}
		if col.Fields.GetByName("reference") == nil {
			col.Fields.Add(&core.TextField{Name: "reference", Max: 4096})
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(assets.Collection)
		if err != nil {
			return nil
		}
		col.Fields.RemoveByName("language")
		col.Fields.RemoveByName("reference")
		return app.Save(col)
	})
}