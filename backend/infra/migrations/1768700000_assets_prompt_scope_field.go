package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/domain/assets"
)

// Adds the prompt_scope select field to the assets collection.
// The parent migration (1768200000_assets_prompt_support) may have
// previously run without this field.  This migration is idempotent
// and only adds the field when it does not yet exist.

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(assets.Collection)
		if err != nil {
			return err
		}
		if col.Fields.GetByName("prompt_scope") != nil {
			return nil // already present
		}
		col.Fields.Add(&core.SelectField{
			Name:   "prompt_scope",
			Values: assets.SupportedPromptScopes,
		})
		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(assets.Collection)
		if err != nil {
			return err
		}
		col.Fields.RemoveByName("prompt_scope")
		return app.Save(col)
	})
}
