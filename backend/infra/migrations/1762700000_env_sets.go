package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		envSets, err := ensureEnvSetsCollection(app)
		if err != nil {
			return err
		}
		return ensureAppsEnvSetsField(app, envSets)
	}, func(app core.App) error {
		if appCol, err := app.FindCollectionByNameOrId("apps"); err == nil {
			appCol.Fields.RemoveByName("env_sets")
			_ = app.Save(appCol)
		}
		col, err := app.FindCollectionByNameOrId("env_sets")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}

func ensureEnvSetsCollection(app core.App) (*core.Collection, error) {
	col, err := app.FindCollectionByNameOrId("env_sets")
	if err != nil {
		col = core.NewBaseCollection("env_sets")
	}

	col.ListRule = types.Pointer("@request.auth.id != ''")
	col.ViewRule = types.Pointer("@request.auth.id != ''")
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil

	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "description"})
	col.AddIndex("idx_env_sets_name", true, "name", "")

	if err := app.Save(col); err != nil {
		return nil, err
	}
	return col, nil
}

func ensureAppsEnvSetsField(app core.App, envSets *core.Collection) error {
	appCol, err := app.FindCollectionByNameOrId("apps")
	if err != nil {
		return err
	}
	appCol.Fields.RemoveByName("env_groups")
	addFieldIfMissing(appCol, &core.RelationField{Name: "env_sets", CollectionId: envSets.Id, MaxSelect: 100})
	return app.Save(appCol)
}