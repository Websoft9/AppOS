package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/infra/collections"
	resourceschema "github.com/websoft9/appos/backend/infra/schema/resource"
)

func init() {
	m.Register(func(app core.App) error {
		return resourceschema.EnsureInstancesCollection(app)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.Instances)
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}
