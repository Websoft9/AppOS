package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/infra/collections"
)

func init() {
	m.Register(func(app core.App) error {
		return ensureMonitorLatestStatusCollection(app)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.MonitorLatestStatus)
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}

func ensureMonitorLatestStatusCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId(collections.MonitorLatestStatus)
	if err != nil {
		col = core.NewBaseCollection(collections.MonitorLatestStatus)
	}

	col.ListRule = types.Pointer("@request.auth.id != ''")
	col.ViewRule = types.Pointer("@request.auth.id != ''")
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil

	addFieldIfMissing(col, &core.SelectField{Name: "target_type", Required: true, MaxSelect: 1, Values: []string{monitor.TargetTypeServer, monitor.TargetTypeApp, monitor.TargetTypeResource, monitor.TargetTypePlatform}})
	addFieldIfMissing(col, &core.TextField{Name: "target_id", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "display_name", Required: true, Max: 200})
	addFieldIfMissing(col, &core.SelectField{Name: "status", Required: true, MaxSelect: 1, Values: []string{monitor.StatusHealthy, monitor.StatusDegraded, monitor.StatusOffline, monitor.StatusUnreachable, monitor.StatusCredentialInvalid, monitor.StatusUnknown}})
	addFieldIfMissing(col, &core.TextField{Name: "reason", Max: 500})
	addFieldIfMissing(col, &core.TextField{Name: "signal_source", Max: 80})
	addFieldIfMissing(col, &core.DateField{Name: "last_transition_at", Required: true})
	addFieldIfMissing(col, &core.DateField{Name: "last_success_at"})
	addFieldIfMissing(col, &core.DateField{Name: "last_failure_at"})
	addFieldIfMissing(col, &core.DateField{Name: "last_checked_at"})
	addFieldIfMissing(col, &core.DateField{Name: "last_reported_at"})
	addFieldIfMissing(col, &core.NumberField{Name: "consecutive_failures", OnlyInt: true})
	addFieldIfMissing(col, &core.JSONField{Name: "summary_json", MaxSize: 1 << 20})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

	col.AddIndex("idx_monitor_latest_target_unique", true, "target_type, target_id", "")
	col.AddIndex("idx_monitor_latest_status_updated", false, "status, updated", "")
	col.AddIndex("idx_monitor_latest_target_status", false, "target_type, status", "")

	return app.Save(col)
}
