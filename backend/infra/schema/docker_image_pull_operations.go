package schema

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/software"
	"github.com/websoft9/appos/backend/infra/collections"
)

func EnsureDockerImagePullOperationsCollection(app core.App) error {
	col, err := app.FindCollectionByNameOrId(collections.DockerImagePullOperations)
	if err != nil {
		col = core.NewBaseCollection(collections.DockerImagePullOperations)
	}
	col.ListRule = authenticatedRule()
	col.ViewRule = authenticatedRule()
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	phases := []string{string(software.OperationPhaseAccepted), string(software.OperationPhaseExecuting), string(software.OperationPhaseSucceeded), string(software.OperationPhaseFailed)}
	terminalStatuses := []string{string(software.TerminalStatusNone), string(software.TerminalStatusSuccess), string(software.TerminalStatusFailed), string(software.TerminalStatusCancelled)}
	failurePhases := []string{string(software.OperationPhaseAccepted), string(software.OperationPhaseExecuting)}
	addFieldIfMissing(col, &core.TextField{Name: "server_id", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "image_name", Required: true, Max: 255})
	addFieldIfMissing(col, &core.TextField{Name: "normalized_name", Required: true, Max: 255})
	addFieldIfMissing(col, &core.SelectField{Name: "phase", Required: true, MaxSelect: 1, Values: phases})
	addFieldIfMissing(col, &core.SelectField{Name: "terminal_status", Required: true, MaxSelect: 1, Values: terminalStatuses})
	addFieldIfMissing(col, &core.SelectField{Name: "failure_phase", MaxSelect: 1, Values: failurePhases})
	addFieldIfMissing(col, &core.TextField{Name: "failure_reason", Max: 2000})
	addFieldIfMissing(col, &core.TextField{Name: "output", Max: 1 << 20})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_docker_pull_ops_server_name_created", false, "server_id, normalized_name, created", "")
	col.AddIndex("idx_docker_pull_ops_inflight", false, "server_id, normalized_name, terminal_status", "")
	return app.Save(col)
}
