package schema

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/software"
	"github.com/websoft9/appos/backend/infra/collections"
)

func EnsureSoftwareOperationsCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId(collections.SoftwareOperations)
	if err != nil {
		col = core.NewBaseCollection(collections.SoftwareOperations)
	}
	col.ListRule = authenticatedRule()
	col.ViewRule = authenticatedRule()
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	phases := []string{string(software.OperationPhaseAccepted), string(software.OperationPhasePreflight), string(software.OperationPhaseExecuting), string(software.OperationPhaseVerifying), string(software.OperationPhaseSucceeded), string(software.OperationPhaseFailed), string(software.OperationPhaseAttentionRequired)}
	terminalStatuses := []string{string(software.TerminalStatusNone), string(software.TerminalStatusSuccess), string(software.TerminalStatusFailed), string(software.TerminalStatusAttentionRequired)}
	failurePhases := []string{string(software.OperationPhaseAccepted), string(software.OperationPhasePreflight), string(software.OperationPhaseExecuting), string(software.OperationPhaseVerifying)}
	failureCodes := []string{string(software.FailureCodeEnqueueError), string(software.FailureCodePreflightError), string(software.FailureCodePreflightBlocked), string(software.FailureCodeExecutionError), string(software.FailureCodeExecutionTimeout), string(software.FailureCodeVerificationDegraded), string(software.FailureCodeVerificationError), string(software.FailureCodeVerificationTimeout), string(software.FailureCodeUninstallTruthMismatch)}
	addFieldIfMissing(col, &core.TextField{Name: "server_id", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "component_key", Required: true, Max: 100})
	addFieldIfMissing(col, &core.TextField{Name: "capability", Max: 100})
	addFieldIfMissing(col, &core.TextField{Name: "action", Required: true, Max: 50})
	addFieldIfMissing(col, &core.SelectField{Name: "phase", Required: true, MaxSelect: 1, Values: phases})
	addFieldIfMissing(col, &core.SelectField{Name: "terminal_status", Required: true, MaxSelect: 1, Values: terminalStatuses})
	addFieldIfMissing(col, &core.SelectField{Name: "failure_phase", MaxSelect: 1, Values: failurePhases})
	addFieldIfMissing(col, &core.SelectField{Name: "failure_code", MaxSelect: 1, Values: failureCodes})
	addFieldIfMissing(col, &core.TextField{Name: "failure_reason", Max: 1000})
	addFieldIfMissing(col, &core.TextField{Name: "event_log", Max: 20000})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_software_ops_server_component", false, "server_id, component_key, created", "")
	col.AddIndex("idx_software_ops_inflight", false, "server_id, component_key, terminal_status", "")
	return app.Save(col)
}
