package orchestration

import (
	"context"
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/internal/lifecycle/model"
)

type RunHooks struct {
	ReloadOperation         func(operationID string) (*core.Record, error)
	IsCancellationRequested func(operation *core.Record) bool
	IsCancelledError        func(err error) bool
	ExecuteNode             func(ctx context.Context, execCtx *ExecutionContext, nodeRun *core.Record, node model.NodeDefinition) error
	OnNodeStarted           func(execCtx *ExecutionContext, nodeRun *core.Record, node model.NodeDefinition)
	OnNodeCompleted         func(execCtx *ExecutionContext, nodeRun *core.Record)
}

type RunResult struct {
	Cancelled bool
	NodeRun   *core.Record
	Node      model.NodeDefinition
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

	for _, node := range execCtx.Definition.Nodes {
		operation, err := hooks.ReloadOperation(execCtx.Operation.Id)
		if err != nil {
			return RunResult{}, err
		}
		execCtx.Operation = operation

		if hooks.IsCancellationRequested != nil && hooks.IsCancellationRequested(execCtx.Operation) {
			return RunResult{Cancelled: true}, nil
		}

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

		err = hooks.ExecuteNode(ctx, execCtx, nodeRun, node)
		if err != nil {
			if hooks.IsCancelledError != nil && hooks.IsCancelledError(err) {
				return RunResult{Cancelled: true, NodeRun: nodeRun, Node: node}, nil
			}
			return RunResult{NodeRun: nodeRun, Node: node}, err
		}

		if err := CompleteNode(app, execCtx, nodeRun); err != nil {
			return RunResult{}, err
		}
		if hooks.OnNodeCompleted != nil {
			hooks.OnNodeCompleted(execCtx, nodeRun)
		}
	}

	return RunResult{}, nil
}