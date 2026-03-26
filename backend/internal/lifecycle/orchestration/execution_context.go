package orchestration

import (
	"fmt"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/internal/lifecycle/metadata"
	"github.com/websoft9/appos/backend/internal/lifecycle/model"
)

type ExecutionContext struct {
	AppRecord  *core.Record
	Operation  *core.Record
	Pipeline   *core.Record
	Definition model.Definition
	NodeRuns   map[string]*core.Record
}

func LoadExecutionContext(app core.App, operationID string) (*ExecutionContext, error) {
	operation, err := app.FindRecordById("app_operations", operationID)
	if err != nil {
		return nil, err
	}
	appRecord, err := app.FindRecordById("app_instances", operation.GetString("app"))
	if err != nil {
		return nil, err
	}
	pipeline, err := app.FindRecordById("pipeline_runs", operation.GetString("pipeline_run"))
	if err != nil {
		return nil, err
	}
	selector := model.DefinitionSelector{
		OperationType: operation.GetString("operation_type"),
		Source:        operation.GetString("trigger_source"),
		Adapter:       operation.GetString("adapter"),
	}
	definition, err := metadata.DefinitionForSelector(selector)
	if err != nil {
		return nil, err
	}
	nodeRunsList, err := app.FindRecordsByFilter(
		mustFindCollection(app, "pipeline_node_runs"),
		fmt.Sprintf("pipeline_run = '%s'", escapePBFilterValue(pipeline.Id)),
		"created",
		100,
		0,
	)
	if err != nil {
		return nil, err
	}
	nodeRuns := make(map[string]*core.Record, len(nodeRunsList))
	for _, nodeRun := range nodeRunsList {
		nodeRuns[nodeRun.GetString("node_key")] = nodeRun
	}

	return &ExecutionContext{
		AppRecord:  appRecord,
		Operation:  operation,
		Pipeline:   pipeline,
		Definition: definition,
		NodeRuns:   nodeRuns,
	}, nil
}

func StartNode(app core.App, execCtx *ExecutionContext, nodeRun *core.Record, node model.NodeDefinition) error {
	now := time.Now()
	nodeRun.Set("status", "running")
	nodeRun.Set("error_message", "")
	nodeRun.Set("execution_log", "")
	nodeRun.Set("execution_log_truncated", false)
	nodeRun.Set("started_at", now)
	if err := app.Save(nodeRun); err != nil {
		return err
	}

	execCtx.Operation.Set("phase", node.Phase)
	if err := app.Save(execCtx.Operation); err != nil {
		return err
	}

	execCtx.Pipeline.Set("status", "active")
	execCtx.Pipeline.Set("current_phase", node.Phase)
	if execCtx.Pipeline.GetDateTime("started_at").IsZero() {
		execCtx.Pipeline.Set("started_at", now)
	}
	return app.Save(execCtx.Pipeline)
}

func CompleteNode(app core.App, execCtx *ExecutionContext, nodeRun *core.Record) error {
	now := time.Now()
	nodeRun.Set("status", "succeeded")
	nodeRun.Set("ended_at", now)
	if err := app.Save(nodeRun); err != nil {
		return err
	}

	execCtx.Pipeline.Set("completed_node_count", execCtx.Pipeline.GetInt("completed_node_count")+1)
	return app.Save(execCtx.Pipeline)
}

func mustFindCollection(app core.App, name string) *core.Collection {
	col, err := app.FindCollectionByNameOrId(name)
	if err != nil {
		panic(err)
	}
	return col
}

func escapePBFilterValue(value string) string {
	result := ""
	for _, part := range value {
		if part == '\'' {
			result += "\\'"
			continue
		}
		result += string(part)
	}
	return result
}
