package orchestration_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
	"github.com/websoft9/appos/backend/domain/lifecycle/orchestration"
	lifecyclesvc "github.com/websoft9/appos/backend/domain/lifecycle/service"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

var errNodeCancelled = errors.New("node cancelled")

func TestRunAdvancesAllNodes(t *testing.T) {
	app, execCtx := newRunnerTestContext(t)
	defer app.Cleanup()

	started := 0
	completed := 0

	result, err := orchestration.Run(context.Background(), app, execCtx, orchestration.RunHooks{
		ReloadOperation: func(operationID string) (*core.Record, error) {
			return app.FindRecordById("app_operations", operationID)
		},
		ExecuteNode: func(ctx context.Context, execCtx *orchestration.ExecutionContext, nodeRun *core.Record, node model.NodeDefinition) (orchestration.NodeExecutionResult, error) {
			return orchestration.NodeExecutionResult{Outcome: orchestration.NodeOutcomeSucceeded}, nil
		},
		OnNodeStarted: func(execCtx *orchestration.ExecutionContext, nodeRun *core.Record, node model.NodeDefinition) {
			started++
		},
		OnNodeCompleted: func(execCtx *orchestration.ExecutionContext, nodeRun *core.Record) {
			completed++
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Cancelled {
		t.Fatal("expected non-cancelled run result")
	}
	if started != len(execCtx.Definition.Nodes) {
		t.Fatalf("expected %d started nodes, got %d", len(execCtx.Definition.Nodes), started)
	}
	if completed != len(execCtx.Definition.Nodes) {
		t.Fatalf("expected %d completed nodes, got %d", len(execCtx.Definition.Nodes), completed)
	}
	if got := execCtx.Pipeline.GetInt("completed_node_count"); got != len(execCtx.Definition.Nodes) {
		t.Fatalf("expected completed_node_count %d, got %d", len(execCtx.Definition.Nodes), got)
	}
	for _, node := range execCtx.Definition.Nodes {
		nodeRun := execCtx.NodeRuns[node.Key]
		if nodeRun.GetString("status") != "succeeded" {
			t.Fatalf("expected node %s succeeded, got %s", node.Key, nodeRun.GetString("status"))
		}
	}
}

func TestRunReturnsCancelledBeforeNodeExecution(t *testing.T) {
	app, execCtx := newRunnerTestContext(t)
	defer app.Cleanup()

	execCtx.Operation.Set("cancel_requested_at", time.Now())
	if err := app.Save(execCtx.Operation); err != nil {
		t.Fatal(err)
	}

	result, err := orchestration.Run(context.Background(), app, execCtx, orchestration.RunHooks{
		ReloadOperation: func(operationID string) (*core.Record, error) {
			return app.FindRecordById("app_operations", operationID)
		},
		IsCancellationRequested: func(operation *core.Record) bool {
			return !operation.GetDateTime("cancel_requested_at").IsZero()
		},
		ExecuteNode: func(ctx context.Context, execCtx *orchestration.ExecutionContext, nodeRun *core.Record, node model.NodeDefinition) (orchestration.NodeExecutionResult, error) {
			t.Fatal("execute node should not be called when operation is already cancelled")
			return orchestration.NodeExecutionResult{}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Cancelled {
		t.Fatal("expected cancelled run result")
	}
	if result.NodeRun != nil {
		t.Fatal("expected no node run when cancelled before execution")
	}
	firstNode := execCtx.NodeRuns[execCtx.Definition.Nodes[0].Key]
	if got := firstNode.GetString("status"); got != "pending" {
		t.Fatalf("expected first node to remain pending, got %s", got)
	}
}

func TestRunReturnsCancelledFromNodeError(t *testing.T) {
	app, execCtx := newRunnerTestContext(t)
	defer app.Cleanup()

	result, err := orchestration.Run(context.Background(), app, execCtx, orchestration.RunHooks{
		ReloadOperation: func(operationID string) (*core.Record, error) {
			return app.FindRecordById("app_operations", operationID)
		},
		IsCancelledError: func(err error) bool {
			return errors.Is(err, errNodeCancelled)
		},
		ExecuteNode: func(ctx context.Context, execCtx *orchestration.ExecutionContext, nodeRun *core.Record, node model.NodeDefinition) (orchestration.NodeExecutionResult, error) {
			return orchestration.NodeExecutionResult{}, errNodeCancelled
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Cancelled {
		t.Fatal("expected cancelled run result")
	}
	if result.NodeRun == nil {
		t.Fatal("expected node run when cancellation happens during execution")
	}
	if got := result.NodeRun.GetString("status"); got != "running" {
		t.Fatalf("expected running node status at cancellation handoff, got %s", got)
	}
	if got := execCtx.Pipeline.GetInt("completed_node_count"); got != 0 {
		t.Fatalf("expected 0 completed nodes, got %d", got)
	}
}

func TestRunUsesDependencyReadyOrderNotDeclarationOrder(t *testing.T) {
	app, execCtx := newRunnerTestContext(t)
	defer app.Cleanup()

	// Force a non-topological declaration order in-memory.
	execCtx.Definition.Nodes = []model.NodeDefinition{
		{Key: "start_runtime", DisplayName: "Start Runtime", Phase: string(model.PipelinePhaseExecuting), DependsOn: []string{"pull_runtime_images"}},
		{Key: "validate_spec", DisplayName: "Validate Spec", Phase: string(model.PipelinePhaseValidating)},
		{Key: "prepare_workspace", DisplayName: "Prepare Workspace", Phase: string(model.PipelinePhasePreparing), DependsOn: []string{"validate_spec"}},
		{Key: "render_runtime_config", DisplayName: "Render Runtime Config", Phase: string(model.PipelinePhasePreparing), DependsOn: []string{"prepare_workspace"}},
		{Key: "pull_runtime_images", DisplayName: "Pull Runtime Images", Phase: string(model.PipelinePhaseExecuting), DependsOn: []string{"render_runtime_config"}},
		{Key: "verify_runtime_health", DisplayName: "Verify Runtime Health", Phase: string(model.PipelinePhaseVerifying), DependsOn: []string{"start_runtime"}},
	}

	started := make([]string, 0)
	_, err := orchestration.Run(context.Background(), app, execCtx, orchestration.RunHooks{
		ReloadOperation: func(operationID string) (*core.Record, error) {
			return app.FindRecordById("app_operations", operationID)
		},
		ExecuteNode: func(ctx context.Context, execCtx *orchestration.ExecutionContext, nodeRun *core.Record, node model.NodeDefinition) (orchestration.NodeExecutionResult, error) {
			started = append(started, node.Key)
			return orchestration.NodeExecutionResult{Outcome: orchestration.NodeOutcomeSucceeded}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"validate_spec", "prepare_workspace", "render_runtime_config", "pull_runtime_images", "start_runtime", "verify_runtime_health"}
	if len(started) != len(want) {
		t.Fatalf("expected %d node starts, got %d (%v)", len(want), len(started), started)
	}
	for i := range want {
		if started[i] != want[i] {
			t.Fatalf("expected start order %v, got %v", want, started)
		}
	}
}
func newRunnerTestContext(t *testing.T) (*tests.TestApp, *orchestration.ExecutionContext) {
	t.Helper()

	baselineDir, err := orchestrationTestBaselineDataDir()
	if err != nil {
		t.Fatal(err)
	}

	app, err := tests.NewTestApp(baselineDir)
	if err != nil {
		t.Fatal(err)
	}

	projectDir := filepath.Join(t.TempDir(), "demo-app")
	operation, err := lifecyclesvc.CreateOperationFromCompose(
		app,
		nil,
		lifecyclesvc.ComposeOperationRequest{
			ServerID:      "local",
			ProjectName:   "Demo App",
			Compose:       "services:\n  web:\n    image: nginx:alpine\n",
			Trigger:       string(model.TriggerManual),
			Channel:       string(model.ChannelCustom),
			ExecutionMode: string(model.ExecutionModeCompose),
		},
		lifecyclesvc.ComposeOperationOptions{ProjectDir: projectDir},
	)
	if err != nil {
		app.Cleanup()
		t.Fatal(err)
	}

	execCtx, err := orchestration.LoadExecutionContext(app, operation.Id)
	if err != nil {
		app.Cleanup()
		t.Fatal(err)
	}

	return app, execCtx
}
