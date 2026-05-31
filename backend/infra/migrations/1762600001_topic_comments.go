package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		topicsCol, err := ensureTopicsCollection(app)
		if err != nil {
			return err
		}

		tc := core.NewBaseCollection("topic_comments")

		authRule := "@request.auth.id != ''"
		ownerRule := "created_by = @request.auth.id"

		tc.ListRule = types.Pointer(authRule)
		tc.ViewRule = types.Pointer(authRule)
		tc.CreateRule = types.Pointer(authRule)
		tc.UpdateRule = types.Pointer(ownerRule)
		tc.DeleteRule = types.Pointer(ownerRule)

		tc.Fields.Add(&core.RelationField{
			Name:          "topic_id",
			CollectionId:  topicsCol.Id,
			Required:      true,
			CascadeDelete: true,
			MaxSelect:     1,
		})
		tc.Fields.Add(&core.TextField{Name: "body", Required: true})
		tc.Fields.Add(&core.TextField{Name: "created_by", Required: true, Max: 100})
		tc.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		tc.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

		return app.Save(tc)
	}, func(app core.App) error {
		if col, err := app.FindCollectionByNameOrId("topic_comments"); err == nil {
			return app.Delete(col)
		}
		return nil
	})
}
