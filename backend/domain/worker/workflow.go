package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/ai/copilot"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/domain/workflow"
	"github.com/websoft9/appos/backend/infra/persistence"
)

const TaskWorkflowRun = "workflow:run"

const workflowRunOrphanThreshold = 10 * time.Minute

type WorkflowRunPayload struct {
	RunID string `json:"run_id"`
}

func NewWorkflowRunTask(runID string) (*asynq.Task, error) {
	if strings.TrimSpace(runID) == "" {
		return nil, fmt.Errorf("run_id is required")
	}
	payload, err := json.Marshal(WorkflowRunPayload{RunID: runID})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskWorkflowRun, payload), nil
}

func EnqueueWorkflowRun(client *asynq.Client, runID string) error {
	if client == nil {
		return fmt.Errorf("asynq client is not configured")
	}
	return enqueueWorkflowRun(client, runID)
}

func enqueueWorkflowRun(client interface {
	Enqueue(task *asynq.Task, opts ...asynq.Option) (*asynq.TaskInfo, error)
}, runID string) error {
	task, err := NewWorkflowRunTask(runID)
	if err != nil {
		return err
	}
	_, err = client.Enqueue(task, asynq.Queue("default"))
	return err
}

func (w *Worker) recoverOrphanedWorkflowRuns() error {
	repo := persistence.NewWorkflowRepository(w.app)
	runs, err := repo.ListOrphanedRuns(context.Background())
	if err != nil {
		return err
	}
	for _, run := range runs {
		updatedAt, parseErr := time.Parse(time.RFC3339, strings.TrimSpace(run.Updated))
		if parseErr == nil && time.Since(updatedAt) < workflowRunOrphanThreshold {
			continue
		}
		if err := workflow.MarkRunOrphaned(context.Background(), repo, run.ID); err != nil {
			return err
		}
	}
	return nil
}

func (w *Worker) handleWorkflowRun(ctx context.Context, t *asynq.Task) error {
	var payload WorkflowRunPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return err
	}
	if strings.TrimSpace(payload.RunID) == "" {
		return fmt.Errorf("run_id is required")
	}
	repo := persistence.NewWorkflowRepository(w.app)
	run, err := repo.GetRun(ctx, payload.RunID)
	if err != nil {
		return err
	}
	if run.Status == workflow.RunStatusCancelled || run.Status == workflow.RunStatusFailed || run.Status == workflow.RunStatusSucceeded {
		return nil
	}
	if workflow.IsTerminalRunStatus(run.Status) && run.Status != workflow.RunStatusPending {
		return nil
	}
	status := workflow.RunStatusRunning
	startedAt := time.Now().UTC().Format(time.RFC3339)
	if run.Status == workflow.RunStatusPending {
		run, err = repo.UpdateRun(ctx, run.ID, workflow.UpdateRunInput{Status: &status, StartedAt: &startedAt})
		if err != nil {
			return err
		}
	}
	defer func() {
		if err != nil {
			failed := workflow.RunStatusFailed
			message := err.Error()
			endedAt := time.Now().UTC().Format(time.RFC3339)
			_, _ = repo.UpdateRun(context.Background(), run.ID, workflow.UpdateRunInput{Status: &failed, ErrorMessage: &message, EndedAt: &endedAt})
		}
	}()
	runner := workflow.NewRunner(repo)
	execCtx, err := runner.LoadExecutionContext(ctx, run.ID, run.DefinitionYAML)
	if err != nil {
		return err
	}
	definition, err := workflow.ParseDefinition(run.DefinitionYAML)
	if err != nil {
		return err
	}
	executorRegistry := workflow.NewExecutorRegistry(w.app)
	providers := persistence.NewAIProviderRepository(w.app)
	resolver := copilot.NewDefaultProviderResolver(providers, workflowSecretResolver{app: w.app}, workflowProviderSelectionResolver{})
	result, err := runner.Run(ctx, execCtx, func(runCtx context.Context, nodeRun *workflow.NodeRunRecord, node workflow.NodeDefinition) (string, map[string]any, error) {
		return executorRegistry.Execute(runCtx, &workflow.ExecutorContext{
			App:        w.app,
			Definition: definition,
			Run:        execCtx.Run,
			NodeRuns:   execCtx.NodeRuns,
			Params:     decodeRunParams(run.ParamsJSON),
			Repo:       repo,
			Resolver:   resolver,
		}, nodeRun, node)
	})
	if err != nil {
		return err
	}
	finished := result.Status
	if finished == "" {
		finished = workflow.RunStatusSucceeded
	}
	endedAt := time.Now().UTC().Format(time.RFC3339)
	update := workflow.UpdateRunInput{Status: &finished}
	if finished == workflow.RunStatusSucceeded || finished == workflow.RunStatusFailed || finished == workflow.RunStatusCancelled {
		update.EndedAt = &endedAt
	}
	_, err = repo.UpdateRun(ctx, run.ID, update)
	return err
}

func decodeRunParams(encoded string) map[string]any {
	if strings.TrimSpace(encoded) == "" {
		return map[string]any{}
	}
	var params map[string]any
	if err := json.Unmarshal([]byte(encoded), &params); err != nil {
		return map[string]any{}
	}
	return params
}

type workflowSecretResolver struct{ app core.App }

func (r workflowSecretResolver) Resolve(_ context.Context, secretID, actorID string) (*secrets.ResolveResult, error) {
	return secrets.Resolve(r.app, secretID, actorID)
}

type workflowProviderSelectionResolver struct{}

func (workflowProviderSelectionResolver) ResolveDefaultProviderIDs(context.Context) ([]string, error) {
	return nil, nil
}
