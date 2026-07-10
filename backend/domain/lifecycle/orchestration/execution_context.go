package orchestration

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/lifecycle/metadata"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
	"github.com/websoft9/appos/backend/domain/lifecycle/rules"
)

type ExecutionContext struct {
	AppRecord   *core.Record
	Operation   *core.Record
	Pipeline    *core.Record
	Definition  model.Definition
	NodeRuns    map[string]*core.Record
	NodesByKey  map[string]model.NodeDefinition
	RuleProfile rules.Profile
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
		ExecutionMode: operation.GetString("execution_mode"),
		RuleProfile:   operation.GetString("rule_profile"),
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
	nodesByKey := make(map[string]model.NodeDefinition, len(definition.Nodes))
	for _, nodeRun := range nodeRunsList {
		nodeRuns[nodeRun.GetString("node_key")] = nodeRun
	}
	for _, node := range definition.Nodes {
		nodesByKey[node.Key] = node
	}
	ruleProfile, _ := rules.Lookup(operation.GetString("rule_profile"))

	return &ExecutionContext{
		AppRecord:   appRecord,
		Operation:   operation,
		Pipeline:    pipeline,
		Definition:  definition,
		NodeRuns:    nodeRuns,
		NodesByKey:  nodesByKey,
		RuleProfile: ruleProfile,
	}, nil
}

func ReadyNodes(execCtx *ExecutionContext) []model.NodeDefinition {
	if execCtx == nil {
		return nil
	}
	ready := make([]model.NodeDefinition, 0)
	for _, node := range execCtx.Definition.Nodes {
		if isCompensationOnlyNode(execCtx, node.Key) {
			continue
		}
		nodeRun := execCtx.NodeRuns[node.Key]
		if nodeRun == nil {
			continue
		}
		status := nodeRun.GetString("status")
		if status != "pending" {
			continue
		}
		if !dependenciesSatisfied(execCtx, node) {
			continue
		}
		ready = append(ready, node)
	}
	sort.SliceStable(ready, func(i, j int) bool {
		left := ready[i]
		right := ready[j]
		if left.Phase == right.Phase {
			return left.Key < right.Key
		}
		return left.Phase < right.Phase
	})
	return ready
}

func isCompensationOnlyNode(execCtx *ExecutionContext, nodeKey string) bool {
	if execCtx == nil || strings.TrimSpace(nodeKey) == "" {
		return false
	}
	for _, node := range execCtx.Definition.Nodes {
		if node.CompensationNodeKey == nodeKey {
			return true
		}
	}
	return false
}

func dependenciesSatisfied(execCtx *ExecutionContext, node model.NodeDefinition) bool {
	for _, dependency := range node.DependsOn {
		dependencyRun := execCtx.NodeRuns[dependency]
		if dependencyRun == nil {
			return false
		}
		switch dependencyRun.GetString("status") {
		case "succeeded", "compensated", "skipped":
			continue
		default:
			return false
		}
	}
	return true
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
