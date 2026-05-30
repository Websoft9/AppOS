package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		secrets, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return err
		}

		col := core.NewBaseCollection("servers")
		col.ListRule = types.Pointer("@request.auth.id != ''")
		col.ViewRule = types.Pointer("@request.auth.id != ''")
		col.CreateRule = nil
		col.UpdateRule = nil
		col.DeleteRule = nil

		col.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 200})
		col.Fields.Add(&core.TextField{Name: "host"})
		col.Fields.Add(&core.NumberField{
			Name:    "port",
			OnlyInt: true,
			Min:     types.Pointer(1.0),
			Max:     types.Pointer(65535.0),
		})
		col.Fields.Add(&core.TextField{Name: "user", Required: true})
		col.Fields.Add(&core.TextField{Name: "connect_type"})
		col.Fields.Add(&core.RelationField{Name: "credential", CollectionId: secrets.Id, MaxSelect: 1})
		col.Fields.Add(&core.TextField{Name: "shell"})

		col.Fields.Add(&core.TextField{Name: "tunnel_status"})
		col.Fields.Add(&core.DateField{Name: "tunnel_last_seen"})
		col.Fields.Add(&core.DateField{Name: "tunnel_connected_at"})
		col.Fields.Add(&core.TextField{Name: "tunnel_remote_addr"})
		col.Fields.Add(&core.DateField{Name: "tunnel_disconnect_at"})
		col.Fields.Add(&core.TextField{Name: "tunnel_disconnect_reason"})
		col.Fields.Add(&core.DateField{Name: "tunnel_pause_until"})
		col.Fields.Add(&core.JSONField{Name: "tunnel_forwards"})
		col.Fields.Add(&core.JSONField{Name: "tunnel_services"})

		col.Fields.Add(&core.TextField{Name: "description"})
		col.Fields.Add(&core.TextField{Name: "created_by"})
		col.Fields.Add(&core.JSONField{Name: "facts_json", MaxSize: 1 << 20})
		col.Fields.Add(&core.DateField{Name: "facts_observed_at"})
		col.Fields.Add(&core.TextField{Name: "access_status"})
		col.Fields.Add(&core.TextField{Name: "access_reason"})
		col.Fields.Add(&core.DateField{Name: "access_checked_at"})
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		col.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

		col.AddIndex("idx_servers_name", true, "name", "")

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}