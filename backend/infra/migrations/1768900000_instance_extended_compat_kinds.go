package migrations

import (
	"slices"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/domain/resource/instances"
	"github.com/websoft9/appos/backend/infra/collections"
)

var extendedInstanceKinds = []string{
	instances.KindMongoDBCompatible,
	instances.KindClickHouseCompatible,
	instances.KindNeo4jCompatible,
	instances.KindInfluxDBCompatible,
	instances.KindElasticsearchCompatible,
	instances.KindOnlyOfficeCompatible,
}

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

		for _, kind := range extendedInstanceKinds {
			if !slices.Contains(field.Values, kind) {
				field.Values = append(field.Values, kind)
			}
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

		field.Values = slices.DeleteFunc(field.Values, func(value string) bool {
			return slices.Contains(extendedInstanceKinds, value)
		})

		return app.Save(col)
	})
}
