package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/resource/instances"
)

func init() {
	m.Register(func(app core.App) error {
		return ensureInstancesCollection(app)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(instances.Collection)
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}

func ensureInstancesCollection(app core.App) error {
	secretsCol, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		return err
	}

	col, err := app.FindCollectionByNameOrId(instances.Collection)
	if err != nil {
		col = core.NewBaseCollection(instances.Collection)
	}

	col.ListRule = types.Pointer("@request.auth.id != ''")
	col.ViewRule = types.Pointer("@request.auth.id != ''")
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil

	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true, Max: 200})
	addFieldIfMissing(col, &core.SelectField{Name: "kind", Required: true, MaxSelect: 1, Values: []string{
		instances.KindMySQL,
		instances.KindPostgres,
		instances.KindRedis,
		instances.KindKafka,
		instances.KindS3,
		instances.KindRegistry,
		instances.KindOllama,
	}})
	addFieldIfMissing(col, &core.TextField{Name: "template_id", Max: 120})
	addFieldIfMissing(col, &core.TextField{Name: "endpoint"})
	addFieldIfMissing(col, &core.RelationField{Name: "credential", CollectionId: secretsCol.Id, MaxSelect: 1})
	addFieldIfMissing(col, &core.JSONField{Name: "config", MaxSize: 1 << 20})
	addFieldIfMissing(col, &core.TextField{Name: "description"})
	col.AddIndex("idx_instances_name", true, "name", "")
	col.AddIndex("idx_instances_kind_template", false, "kind, template_id", "")

	return app.Save(col)
}
