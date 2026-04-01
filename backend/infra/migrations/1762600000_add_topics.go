package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Story 22.1: Topics Backend
//
//  1. Create `topics` collection (title, description, created_by)
//  2. Create `topic_comments` collection (topic_id, body, created_by)
//     with cascade-delete on topic_id.

func init() {
	m.Register(func(app core.App) error {

		// ─── 1. topics collection ────────────────────────────
		t := core.NewBaseCollection("topics")

		authRule := "@request.auth.id != ''"
		ownerRule := "created_by = @request.auth.id"

		t.ListRule = types.Pointer(authRule)
		t.ViewRule = types.Pointer(authRule)
		t.CreateRule = types.Pointer(authRule)
		t.UpdateRule = types.Pointer(ownerRule)
		t.DeleteRule = types.Pointer(ownerRule)

		t.Fields.Add(&core.TextField{
			Name:     "title",
			Required: true,
			Max:      500,
		})
		t.Fields.Add(&core.TextField{
			Name: "description",
		})
		t.Fields.Add(&core.TextField{
			Name:     "created_by",
			Required: true,
			Max:      100,
		})
		t.Fields.Add(&core.BoolField{
			Name: "closed",
		})
		t.Fields.Add(&core.TextField{
			Name: "share_token",
			Max:  128,
		})
		t.Fields.Add(&core.TextField{
			Name: "share_expires_at",
			Max:  64,
		})
		t.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		t.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

		if err := app.Save(t); err != nil {
			return err
		}

		// ─── 2. topic_comments collection ────────────────────
		tc := core.NewBaseCollection("topic_comments")

		tc.ListRule = types.Pointer(authRule)
		tc.ViewRule = types.Pointer(authRule)
		tc.CreateRule = types.Pointer(authRule)
		tc.UpdateRule = types.Pointer(ownerRule)
		tc.DeleteRule = types.Pointer(ownerRule)

		tc.Fields.Add(&core.RelationField{
			Name:          "topic_id",
			CollectionId:  t.Id,
			Required:      true,
			CascadeDelete: true,
			MaxSelect:     1,
		})
		tc.Fields.Add(&core.TextField{
			Name:     "body",
			Required: true,
		})
		tc.Fields.Add(&core.TextField{
			Name:     "created_by",
			Required: true,
			Max:      100,
		})
		tc.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		tc.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

		if err := app.Save(tc); err != nil {
			return err
		}

		return nil
	}, func(app core.App) error {
		// Down: delete topic_comments first (has FK to topics), then topics.
		if col, err := app.FindCollectionByNameOrId("topic_comments"); err == nil {
			_ = app.Delete(col)
		}
		if col, err := app.FindCollectionByNameOrId("topics"); err == nil {
			_ = app.Delete(col)
		}
		return nil
	})
}
