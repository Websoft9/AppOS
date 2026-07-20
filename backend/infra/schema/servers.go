package schema

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

func EnsureServersCollection(app core.App) error {
	secrets, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		return err
	}
	col, err := app.FindCollectionByNameOrId("servers")
	if err != nil {
		col = core.NewBaseCollection("servers")
	}
	col.ListRule = authenticatedRule()
	col.ViewRule = authenticatedRule()
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	removeFieldIfExists(col, "state")
	removeFieldIfExists(col, "remote_proxy")
	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "host"})
	addFieldIfMissing(col, &core.NumberField{Name: "port", OnlyInt: true, Min: types.Pointer(1.0), Max: types.Pointer(65535.0)})
	addFieldIfMissing(col, &core.TextField{Name: "user", Required: true})
	addFieldIfMissing(col, &core.TextField{Name: "connect_type"})
	addFieldIfMissing(col, &core.BoolField{Name: "is_enabled"})
	addFieldIfMissing(col, &core.BoolField{Name: "is_local"})
	addFieldIfMissing(col, &core.RelationField{Name: "credential", CollectionId: secrets.Id, MaxSelect: 1})
	addFieldIfMissing(col, &core.TextField{Name: "shell"})
	addFieldIfMissing(col, &core.TextField{Name: "tunnel_status"})
	addFieldIfMissing(col, &core.DateField{Name: "tunnel_last_seen"})
	addFieldIfMissing(col, &core.DateField{Name: "tunnel_connected_at"})
	addFieldIfMissing(col, &core.TextField{Name: "tunnel_remote_addr"})
	addFieldIfMissing(col, &core.DateField{Name: "tunnel_disconnect_at"})
	addFieldIfMissing(col, &core.TextField{Name: "tunnel_disconnect_reason"})
	addFieldIfMissing(col, &core.DateField{Name: "tunnel_pause_until"})
	addFieldIfMissing(col, &core.JSONField{Name: "tunnel_forwards"})
	addFieldIfMissing(col, &core.JSONField{Name: "tunnel_services"})
	addFieldIfMissing(col, &core.TextField{Name: "description"})
	addFieldIfMissing(col, &core.TextField{Name: "created_by"})
	addFieldIfMissing(col, &core.JSONField{Name: "facts_json", MaxSize: 1 << 20})
	addFieldIfMissing(col, &core.DateField{Name: "facts_observed_at"})
	addFieldIfMissing(col, &core.TextField{Name: "access_status"})
	addFieldIfMissing(col, &core.TextField{Name: "access_reason"})
	addFieldIfMissing(col, &core.DateField{Name: "access_checked_at"})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_servers_name", true, "name", "")
	return app.Save(col)
}
