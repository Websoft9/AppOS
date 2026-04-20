package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/software"
	"github.com/websoft9/appos/backend/infra/collections"
)

// Story 29.7: Create software_operations collection for tracking async software delivery operations.
//
// Schema follows SoftwareDeliveryOperation from domain/software/model.go.
// Access rules: authenticated users may list/view; all writes go through the backend.
func init() {
	m.Register(func(app core.App) error {
		return ensureSoftwareOperationsCollection(app)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(collections.SoftwareOperations)
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}

func ensureSoftwareOperationsCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId(collections.SoftwareOperations)
	if err != nil {
		col = core.NewBaseCollection(collections.SoftwareOperations)
	}

	// Authenticated users may read; all writes go through backend service layer.
	authRule := types.Pointer("@request.auth.id != ''")
	col.ListRule = authRule
	col.ViewRule = authRule
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil

	phases := []string{
		string(software.OperationPhaseAccepted),
		string(software.OperationPhasePreflight),
		string(software.OperationPhaseExecuting),
		string(software.OperationPhaseVerifying),
		string(software.OperationPhaseSucceeded),
		string(software.OperationPhaseFailed),
		string(software.OperationPhaseAttentionRequired),
	}
	terminalStatuses := []string{
		string(software.TerminalStatusNone),
		string(software.TerminalStatusSuccess),
		string(software.TerminalStatusFailed),
	}

	addFieldIfMissing(col, &core.TextField{Name: "server_id", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "component_key", Required: true, Max: 100})
	addFieldIfMissing(col, &core.TextField{Name: "capability", Max: 100})
	addFieldIfMissing(col, &core.TextField{Name: "action", Required: true, Max: 50})
	addFieldIfMissing(col, &core.SelectField{Name: "phase", Required: true, MaxSelect: 1, Values: phases})
	addFieldIfMissing(col, &core.SelectField{Name: "terminal_status", Required: true, MaxSelect: 1, Values: terminalStatuses})
	addFieldIfMissing(col, &core.TextField{Name: "failure_reason", Max: 1000})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

	// Index for looking up the latest operation for a specific component on a server.
	col.AddIndex("idx_software_ops_server_component", false, "server_id, component_key, created", "")
	// Index for checking in-flight operations (no terminal_status = still running).
	col.AddIndex("idx_software_ops_inflight", false, "server_id, component_key, terminal_status", "")

	return app.Save(col)
}
