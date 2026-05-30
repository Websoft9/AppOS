package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		_, err := ensureTopicsCollection(app)
		return err
	}, func(app core.App) error {
		if col, err := app.FindCollectionByNameOrId("topics"); err == nil {
			return app.Delete(col)
		}
		return nil
	})
}

func ensureTopicsCollection(app core.App) (*core.Collection, error) {
	if existing, err := app.FindCollectionByNameOrId("topics"); err == nil {
		return existing, nil
	}

	t := core.NewBaseCollection("topics")

	authRule := "@request.auth.id != ''"
	ownerRule := "created_by = @request.auth.id"

	t.ListRule = types.Pointer(authRule)
	t.ViewRule = types.Pointer(authRule)
	t.CreateRule = types.Pointer(authRule)
	t.UpdateRule = types.Pointer(ownerRule)
	t.DeleteRule = types.Pointer(ownerRule)

	t.Fields.Add(&core.TextField{Name: "title", Required: true, Max: 500})
	t.Fields.Add(&core.TextField{Name: "description"})
	t.Fields.Add(&core.TextField{Name: "created_by", Required: true, Max: 100})
	t.Fields.Add(&core.BoolField{Name: "closed"})
	t.Fields.Add(&core.TextField{Name: "share_token", Max: 128})
	t.Fields.Add(&core.TextField{Name: "share_expires_at", Max: 64})
	t.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	t.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

	if err := app.Save(t); err != nil {
		return nil, err
	}
	return t, nil
}
