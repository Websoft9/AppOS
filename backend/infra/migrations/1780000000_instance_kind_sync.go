package migrations

import (
	"slices"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/domain/resource/instances"
	"github.com/websoft9/appos/backend/infra/collections"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.Instances)
		if err != nil {
			return nil
		}

		field, ok := col.Fields.GetByName("kind").(*core.SelectField)
		if !ok || field == nil {
			return nil
		}

		allowed := instances.AllowedKinds()
		added := 0
		for _, kind := range allowed {
			if !slices.Contains(field.Values, kind) {
				field.Values = append(field.Values, kind)
				added++
			}
		}

		if added == 0 {
			return nil
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.Instances)
		if err != nil {
			return nil
		}

		field, ok := col.Fields.GetByName("kind").(*core.SelectField)
		if !ok || field == nil {
			return nil
		}

		field.Values = instances.AllowedKinds()
		return app.Save(col)
	})
}
