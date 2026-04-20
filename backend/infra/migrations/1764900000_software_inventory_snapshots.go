package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/software"
	"github.com/websoft9/appos/backend/infra/collections"
)

// Story 29 follow-up: persist installed software inventory as a target-scoped projection.
func init() {
	m.Register(func(app core.App) error {
		return ensureSoftwareInventorySnapshotsCollection(app)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.SoftwareInventorySnapshots)
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}

func ensureSoftwareInventorySnapshotsCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId(collections.SoftwareInventorySnapshots)
	if err != nil {
		col = core.NewBaseCollection(collections.SoftwareInventorySnapshots)
	}

	authRule := types.Pointer("@request.auth.id != ''")
	col.ListRule = authRule
	col.ViewRule = authRule
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil

	addFieldIfMissing(col, &core.SelectField{
		Name:      "target_type",
		Required:  true,
		MaxSelect: 1,
		Values: []string{
			string(software.TargetTypeLocal),
			string(software.TargetTypeServer),
		},
	})
	addFieldIfMissing(col, &core.TextField{Name: "target_id", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "component_key", Required: true, Max: 100})
	addFieldIfMissing(col, &core.TextField{Name: "label", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "template_kind", Required: true, Max: 50})
	addFieldIfMissing(col, &core.SelectField{
		Name:      "installed_state",
		Required:  true,
		MaxSelect: 1,
		Values: []string{
			string(software.InstalledStateInstalled),
			string(software.InstalledStateNotInstalled),
			string(software.InstalledStateUnknown),
		},
	})
	addFieldIfMissing(col, &core.TextField{Name: "detected_version", Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "packaged_version", Max: 200})
	addFieldIfMissing(col, &core.SelectField{
		Name:      "verification_state",
		Required:  true,
		MaxSelect: 1,
		Values: []string{
			string(software.VerificationStateHealthy),
			string(software.VerificationStateDegraded),
			string(software.VerificationStateUnknown),
		},
	})
	addFieldIfMissing(col, &core.TextField{Name: "service_name", Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "binary_path", Max: 500})
	addFieldIfMissing(col, &core.JSONField{Name: "preflight_json", MaxSize: 1 << 20})
	addFieldIfMissing(col, &core.JSONField{Name: "verification_json", MaxSize: 1 << 20})
	addFieldIfMissing(col, &core.JSONField{Name: "last_action_json", MaxSize: 1 << 20})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

	col.AddIndex("idx_software_inventory_target_component", true, "target_type, target_id, component_key", "")
	col.AddIndex("idx_software_inventory_target", false, "target_type, target_id, updated", "")

	return app.Save(col)
}
