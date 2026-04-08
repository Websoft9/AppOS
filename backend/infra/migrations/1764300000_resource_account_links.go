package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/infra/collections"
)

func init() {
	m.Register(func(app core.App) error {
		return addResourceAccountLinks(app)
	}, func(app core.App) error {
		return removeResourceAccountLinks(app)
	})
}

func addResourceAccountLinks(app core.App) error {
	accountsCol, err := app.FindCollectionByNameOrId(collections.ProviderAccounts)
	if err != nil {
		return err
	}

	if err := addProviderAccountField(app, collections.Instances, accountsCol.Id); err != nil {
		return err
	}
	if err := addProviderAccountField(app, collections.Connectors, accountsCol.Id); err != nil {
		return err
	}
	return nil
}

func removeResourceAccountLinks(app core.App) error {
	if err := removeProviderAccountField(app, collections.Instances); err != nil {
		return err
	}
	if err := removeProviderAccountField(app, collections.Connectors); err != nil {
		return err
	}
	return nil
}

func addProviderAccountField(app core.App, collectionName string, accountCollectionID string) error {
	col, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		return err
	}
	addFieldIfMissing(col, &core.RelationField{Name: "provider_account", CollectionId: accountCollectionID, MaxSelect: 1})
	return app.Save(col)
}

func removeProviderAccountField(app core.App, collectionName string) error {
	col, err := app.FindCollectionByNameOrId(collectionName)
	if err != nil {
		return nil
	}
	col.Fields.RemoveByName("provider_account")
	return app.Save(col)
}
