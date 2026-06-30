package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/infra/collections"
	resourceschema "github.com/websoft9/appos/backend/infra/schema/resource"
)

func init() {
	m.Register(func(app core.App) error {
		if err := resourceschema.EnsureProviderAccountsCollection(app); err != nil {
			return err
		}
		return resourceschema.EnsureProviderAccountDependents(app)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.ProviderAccounts)
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}
