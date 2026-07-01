package schema

import "github.com/pocketbase/pocketbase/core"

func EnsureEnvSetVarsCollection(app core.App) error {
	envSets, err := app.FindCollectionByNameOrId("env_sets")
	if err != nil {
		return err
	}
	secretsCol, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		return err
	}
	col, err := app.FindCollectionByNameOrId("env_set_vars")
	if err != nil {
		col = core.NewBaseCollection("env_set_vars")
	}
	col.ListRule = authenticatedRule()
	col.ViewRule = authenticatedRule()
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.RelationField{Name: "set", CollectionId: envSets.Id, Required: true, MaxSelect: 1, CascadeDelete: true})
	addFieldIfMissing(col, &core.TextField{Name: "key", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "value"})
	addFieldIfMissing(col, &core.BoolField{Name: "is_secret"})
	addFieldIfMissing(col, &core.RelationField{Name: "secret", CollectionId: secretsCol.Id, MaxSelect: 1})
	col.AddIndex("idx_env_set_vars_set", false, "`set`", "")
	col.AddIndex("idx_env_set_vars_set_key", true, "`set`, `key`", "")
	return app.Save(col)
}
