package orchestration

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
)

func SeedPipelineRun(txApp core.App, operationRecord *core.Record, definition model.Definition) (*core.Record, error) {
	pipelineRunsCol, err := txApp.FindCollectionByNameOrId("pipeline_runs")
	if err != nil {
		return nil, err
	}
	nodeRunsCol, err := txApp.FindCollectionByNameOrId("pipeline_node_runs")
	if err != nil {
		return nil, err
	}

	pipelineRun := core.NewRecord(pipelineRunsCol)
	pipelineRun.Set("operation", operationRecord.Id)
	pipelineRun.Set("pipeline_family", definition.Family)
	pipelineRun.Set("pipeline_definition_key", definition.Key)
	pipelineRun.Set("pipeline_version", definition.Version)
	pipelineRun.Set("current_phase", definition.InitialPhase)
	pipelineRun.Set("status", "active")
	pipelineRun.Set("node_count", len(definition.Nodes))
	pipelineRun.Set("completed_node_count", 0)
	if err := txApp.Save(pipelineRun); err != nil {
		return nil, err
	}

	for _, node := range definition.Nodes {
		nodeRun := core.NewRecord(nodeRunsCol)
		nodeRun.Set("pipeline_run", pipelineRun.Id)
		nodeRun.Set("node_key", node.Key)
		nodeRun.Set("node_type", node.NodeType)
		nodeRun.Set("display_name", node.DisplayName)
		nodeRun.Set("phase", node.Phase)
		if len(node.DependsOn) > 0 {
			nodeRun.Set("depends_on_json", node.DependsOn)
		}
		if node.CompensationNodeKey != "" {
			nodeRun.Set("compensation_node_key", node.CompensationNodeKey)
		}
		nodeRun.Set("status", "pending")
		nodeRun.Set("retry_count", 0)
		if err := txApp.Save(nodeRun); err != nil {
			return nil, err
		}
	}

	return pipelineRun, nil
}
