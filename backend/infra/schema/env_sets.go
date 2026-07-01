package schema

import "github.com/pocketbase/pocketbase/core"

func EnsureEnvSetsCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId("env_sets")
	if err != nil {
		col = core.NewBaseCollection("env_sets")
	}
	col.ListRule = authenticatedRule()
	col.ViewRule = authenticatedRule()
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "description"})
	col.AddIndex("idx_env_sets_name", true, "name", "")
	if err := app.Save(col); err != nil {
		return err
	}
	return ensureAppsEnvSetsField(app, col)
}

func ensureAppsEnvSetsField(app core.App, envSets *core.Collection) error {
	appCol, err := app.FindCollectionByNameOrId("apps")
	if err != nil {
		return err
	}
	removeFieldIfExists(appCol, "env_groups")
	addFieldIfMissing(appCol, &core.RelationField{Name: "env_sets", CollectionId: envSets.Id, MaxSelect: 100})
	return app.Save(appCol)
}
