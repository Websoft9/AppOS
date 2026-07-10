package orchestration

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
)

type NodeOutcome string

const (
	NodeOutcomeSucceeded  NodeOutcome = "succeeded"
	NodeOutcomeWaiting    NodeOutcome = "waiting"
	NodeOutcomeManualGate NodeOutcome = "manual_gate"
)

type NodeExecutionResult struct {
	Outcome NodeOutcome
	Message string
}

type RunHooks struct {
	ReloadOperation         func(operationID string) (*core.Record, error)
	IsCancellationRequested func(operation *core.Record) bool
	IsCancelledError        func(err error) bool
	ExecuteNode             func(ctx context.Context, execCtx *ExecutionContext, nodeRun *core.Record, node model.NodeDefinition) (NodeExecutionResult, error)
	OnNodeStarted           func(execCtx *ExecutionContext, nodeRun *core.Record, node model.NodeDefinition)
	OnNodeCompleted         func(execCtx *ExecutionContext, nodeRun *core.Record)
}

type RunResult struct {
	Cancelled   bool
	Waiting     bool
	ManualGate  bool
	Compensated bool
	NodeRun     *core.Record
	Node        model.NodeDefinition
}

func Run(ctx context.Context, app core.App, execCtx *ExecutionContext, hooks RunHooks) (RunResult, error) {
	if execCtx == nil {
		return RunResult{}, fmt.Errorf("execution context is required")
	}
	if hooks.ReloadOperation == nil {
		return RunResult{}, fmt.Errorf("reload operation hook is required")
	}
	if hooks.ExecuteNode == nil {
		return RunResult{}, fmt.Errorf("execute node hook is required")
	}

	if hooks.IsCancellationRequested != nil && hooks.IsCancellationRequested(execCtx.Operation) {
		return RunResult{Cancelled: true}, nil
	}

	for {
		operation, err := hooks.ReloadOperation(execCtx.Operation.Id)
		if err != nil {
			return RunResult{}, err
		}
		execCtx.Operation = operation

		if hooks.IsCancellationRequested != nil && hooks.IsCancellationRequested(execCtx.Operation) {
			return RunResult{Cancelled: true}, nil
		}

		readyNodes := ReadyNodes(execCtx)
		if len(readyNodes) == 0 {
			if allNodesTerminal(execCtx) {
				return RunResult{}, nil
			}
			return RunResult{}, fmt.Errorf("pipeline stalled: no ready nodes remain")
		}

		maxParallel := 1
		if execCtx.RuleProfile.MaxParallelNodes > 1 {
			maxParallel = execCtx.RuleProfile.MaxParallelNodes
		}
		if maxParallel > len(readyNodes) {
			maxParallel = len(readyNodes)
		}
		selected := readyNodes[:maxParallel]

		type runItem struct {
			node    model.NodeDefinition
			nodeRun *core.Record
			result  NodeExecutionResult
			err     error
		}
		results := make([]runItem, 0, len(selected))
		for _, node := range selected {
			nodeRun := execCtx.NodeRuns[node.Key]
			if nodeRun == nil {
				return RunResult{}, fmt.Errorf("pipeline node run missing for %s", node.Key)
			}
			if err := StartNode(app, execCtx, nodeRun, node); err != nil {
				return RunResult{}, err
			}
			if hooks.OnNodeStarted != nil {
				hooks.OnNodeStarted(execCtx, nodeRun, node)
			}
			results = append(results, runItem{node: node, nodeRun: nodeRun})
		}

		var wg sync.WaitGroup
		for index := range results {
			if results[index].node.ManualGate {
				results[index].result = NodeExecutionResult{Outcome: NodeOutcomeManualGate, Message: "manual approval required"}
				continue
			}
			if strings.TrimSpace(results[index].node.NodeType) == "wait" {
				results[index].result = NodeExecutionResult{Outcome: NodeOutcomeWaiting, Message: "waiting for external condition"}
				continue
			}
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				results[i].result, results[i].err = hooks.ExecuteNode(ctx, execCtx, results[i].nodeRun, results[i].node)
			}(index)
		}
		wg.Wait()

		for _, item := range results {
			if item.err != nil {
				if hooks.IsCancelledError != nil && hooks.IsCancelledError(item.err) {
					return RunResult{Cancelled: true, NodeRun: item.nodeRun, Node: item.node}, nil
				}
				if strings.TrimSpace(item.node.CompensationNodeKey) != "" {
					if compensationErr := compensateNode(ctx, app, execCtx, hooks, item.node, item.nodeRun); compensationErr == nil {
						return RunResult{Compensated: true, NodeRun: item.nodeRun, Node: item.node}, nil
					}
				}
				return RunResult{NodeRun: item.nodeRun, Node: item.node}, item.err
			}
			switch item.result.Outcome {
			case NodeOutcomeWaiting:
				markNodeTerminal(app, item.nodeRun, "waiting", item.result.Message)
				return RunResult{Waiting: true, NodeRun: item.nodeRun, Node: item.node}, nil
			case NodeOutcomeManualGate:
				markNodeTerminal(app, item.nodeRun, "manual_gate", item.result.Message)
				return RunResult{ManualGate: true, NodeRun: item.nodeRun, Node: item.node}, nil
			default:
				if err := CompleteNode(app, execCtx, item.nodeRun); err != nil {
					return RunResult{}, err
				}
				if hooks.OnNodeCompleted != nil {
					hooks.OnNodeCompleted(execCtx, item.nodeRun)
				}
			}
		}
	}
}

func markNodeTerminal(app core.App, nodeRun *core.Record, status string, message string) error {
	if app == nil || nodeRun == nil {
		return nil
	}
	nodeRun.Set("status", status)
	nodeRun.Set("error_message", strings.TrimSpace(message))
	nodeRun.Set("ended_at", time.Now())
	return app.Save(nodeRun)
}

func compensateNode(ctx context.Context, app core.App, execCtx *ExecutionContext, hooks RunHooks, node model.NodeDefinition, failedNodeRun *core.Record) error {
	compensationNode, ok := execCtx.NodesByKey[node.CompensationNodeKey]
	if !ok {
		return fmt.Errorf("compensation node %s not found", node.CompensationNodeKey)
	}
	compensationRun := execCtx.NodeRuns[node.CompensationNodeKey]
	if compensationRun == nil {
		return fmt.Errorf("compensation node run %s not found", node.CompensationNodeKey)
	}
	if err := StartNode(app, execCtx, compensationRun, compensationNode); err != nil {
		return err
	}
	result, err := hooks.ExecuteNode(ctx, execCtx, compensationRun, compensationNode)
	if err != nil {
		return err
	}
	if result.Outcome != "" && result.Outcome != NodeOutcomeSucceeded {
		return fmt.Errorf("compensation node %s returned unsupported outcome %s", compensationNode.Key, result.Outcome)
	}
	if err := CompleteNode(app, execCtx, compensationRun); err != nil {
		return err
	}
	failedNodeRun.Set("status", "compensated")
	failedNodeRun.Set("error_message", strings.TrimSpace(failedNodeRun.GetString("error_message"))+" | compensated")
	return app.Save(failedNodeRun)
}

func allNodesTerminal(execCtx *ExecutionContext) bool {
	for _, nodeRun := range execCtx.NodeRuns {
		switch nodeRun.GetString("status") {
		case "succeeded", "failed", "cancelled", "compensated", "skipped", "waiting", "manual_gate":
			continue
		default:
			return false
		}
	}
	return true
}
