package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/internal/audit"
	"github.com/websoft9/appos/backend/internal/deploy"
	"github.com/websoft9/appos/backend/internal/docker"
	"github.com/websoft9/appos/backend/internal/lifecycle/model"
	"github.com/websoft9/appos/backend/internal/lifecycle/orchestration"
	"github.com/websoft9/appos/backend/internal/lifecycle/projection"
	lifecycleruntime "github.com/websoft9/appos/backend/internal/lifecycle/runtime"
)

const (
	TaskRunOperation           = "lifecycle:run_operation"
	lifecycleSchedulerInterval = 2 * time.Second
)

type RunOperationPayload struct {
	OperationID string `json:"operation_id"`
}

type lifecycleExecutionContext struct {
	*orchestration.ExecutionContext
	executor   lifecycleruntime.Executor
	docker     *docker.Client
}

var errOperationCancelled = errors.New("operation cancelled")

var operationExecutorFactory = func(app core.App, serverID string) lifecycleruntime.Executor {
	return lifecycleruntime.NewDeploymentExecutor(app, serverID)
}

var operationHealthCheck lifecycleruntime.HealthChecker = lifecycleruntime.RunDeploymentHealthCheck

func NewRunOperationTask(operationID string) (*asynq.Task, error) {
	if strings.TrimSpace(operationID) == "" {
		return nil, fmt.Errorf("operation_id is required")
	}
	payload, err := json.Marshal(RunOperationPayload{OperationID: operationID})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskRunOperation, payload), nil
}

func EnqueueOperation(client *asynq.Client, operationID string) error {
	if client == nil {
		return fmt.Errorf("asynq client is not configured")
	}
	task, err := NewRunOperationTask(operationID)
	if err != nil {
		return err
	}
	_, err = client.Enqueue(task, asynq.Queue("critical"))
	return err
}

func (w *Worker) startLifecycleScheduler() {
	if w.client == nil {
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	w.schedulerCancel = cancel
	w.backgroundWG.Add(1)
	go func() {
		defer w.backgroundWG.Done()
		if err := w.dispatchQueuedOperations(); err != nil {
			log.Printf("dispatch queued operations: %v", err)
		}

		ticker := time.NewTicker(lifecycleSchedulerInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := w.dispatchQueuedOperations(); err != nil {
					log.Printf("dispatch queued operations: %v", err)
				}
			}
		}
	}()
}

func (w *Worker) dispatchQueuedOperations() error {
	if w.client == nil {
		return nil
	}

	col, err := w.app.FindCollectionByNameOrId("app_operations")
	if err != nil {
		return nil
	}

	records, err := w.app.FindRecordsByFilter(
		col,
		fmt.Sprintf("phase = '%s' && terminal_status = ''", escapePBFilterValue(string(model.OperationPhaseQueued))),
		"queued_at",
		20,
		0,
	)
	if err != nil {
		return err
	}

	for _, record := range records {
		if err := EnqueueOperation(w.client, record.Id); err != nil {
			log.Printf("enqueue operation %s: %v", record.Id, err)
		}
	}

	return nil
}

func (w *Worker) recoverOrphanedOperations() error {
	col, err := w.app.FindCollectionByNameOrId("app_operations")
	if err != nil {
		return nil
	}

	records, err := w.app.FindRecordsByFilter(
		col,
		fmt.Sprintf("terminal_status = '' && phase != '%s'", escapePBFilterValue(string(model.OperationPhaseQueued))),
		"-updated",
		200,
		0,
	)
	if err != nil {
		return err
	}

	for _, record := range records {
		if err := w.markOrphanedOperationFailed(record.Id); err != nil {
			return err
		}
	}

	return nil
}

func (w *Worker) markOrphanedOperationFailed(operationID string) error {
	ctx, err := w.loadLifecycleExecutionContext(operationID)
	if err != nil {
		return err
	}

	now := time.Now()
	appendOperationLog(w.app, ctx.Operation, "worker startup detected orphaned operation")
	for _, nodeRun := range ctx.NodeRuns {
		if nodeRun.GetString("status") != "running" {
			continue
		}
		nodeRun.Set("status", "failed")
		nodeRun.Set("error_message", "operation orphaned after worker restart")
		nodeRun.Set("ended_at", now)
		if err := w.app.Save(nodeRun); err != nil {
			return err
		}
		ctx.Pipeline.Set("failed_node_key", nodeRun.GetString("node_key"))
	}

	ctx.Pipeline.Set("status", "failed")
	ctx.Pipeline.Set("ended_at", now)
	if err := w.app.Save(ctx.Pipeline); err != nil {
		return err
	}

	ctx.Operation.Set("terminal_status", "failed")
	ctx.Operation.Set("failure_reason", "unknown")
	ctx.Operation.Set("app_outcome", operationFailureOutcome(ctx.AppRecord))
	ctx.Operation.Set("error_message", "operation orphaned after worker restart")
	ctx.Operation.Set("ended_at", now)
	if err := w.app.Save(ctx.Operation); err != nil {
		return err
	}

	projection.ApplyOperationFailed(ctx.AppRecord, ctx.Operation)
	return w.app.Save(ctx.AppRecord)
}

func (w *Worker) handleRunOperation(ctx context.Context, t *asynq.Task) error {
	var payload RunOperationPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return err
	}
	if payload.OperationID == "" {
		return fmt.Errorf("operation_id is required")
	}

	record, err := w.claimQueuedOperation(payload.OperationID)
	if err != nil {
		return err
	}
	if record == nil {
		return nil
	}

	serverID := normalizeDeployServerID(record.GetString("server_id"))
	lock := deploymentServerLock(serverID)
	lock.Lock()
	defer lock.Unlock()

	execCtx, err := w.loadLifecycleExecutionContext(record.Id)
	if err != nil {
		return err
	}
	appendOperationLog(w.app, execCtx.Operation, "job accepted by lifecycle worker")

	runResult, err := orchestration.Run(ctx, w.app, execCtx.ExecutionContext, orchestration.RunHooks{
		ReloadOperation: func(operationID string) (*core.Record, error) {
			return w.app.FindRecordById("app_operations", operationID)
		},
		IsCancellationRequested: isOperationCancellationRequested,
		IsCancelledError: func(err error) bool {
			return errors.Is(err, errOperationCancelled)
		},
		ExecuteNode: func(ctx context.Context, runCtx *orchestration.ExecutionContext, nodeRun *core.Record, node model.NodeDefinition) error {
			execCtx.ExecutionContext = runCtx
			return w.executeNode(ctx, execCtx, nodeRun, node)
		},
		OnNodeStarted: func(runCtx *orchestration.ExecutionContext, nodeRun *core.Record, node model.NodeDefinition) {
			execCtx.ExecutionContext = runCtx
			appendOperationLog(w.app, execCtx.Operation, "step started: "+node.DisplayName)
		},
		OnNodeCompleted: func(runCtx *orchestration.ExecutionContext, nodeRun *core.Record) {
			execCtx.ExecutionContext = runCtx
			appendOperationLog(w.app, execCtx.Operation, "step completed: "+nodeRun.GetString("display_name"))
		},
	})
	if err != nil {
		return w.finishOperationFailed(execCtx, runResult.NodeRun, runResult.Node, err)
	}
	if runResult.Cancelled {
		message := "operation cancelled before execution"
		if runResult.NodeRun != nil {
			message = "operation cancelled"
		}
		return w.finishOperationCancelled(execCtx, runResult.NodeRun, message)
	}

	return w.finishOperationSucceeded(execCtx)
}

func (w *Worker) claimQueuedOperation(operationID string) (*core.Record, error) {
	if _, err := w.app.FindCollectionByNameOrId("app_operations"); err != nil {
		return nil, nil
	}

	var claimed *core.Record
	err := w.app.RunInTransaction(func(txApp core.App) error {
		record, err := txApp.FindRecordById("app_operations", operationID)
		if err != nil {
			return err
		}
		if record.GetString("terminal_status") != "" || record.GetString("phase") != string(model.OperationPhaseQueued) {
			claimed = nil
			return nil
		}

		col, err := txApp.FindCollectionByNameOrId("app_operations")
		if err != nil {
			return err
		}
		filter := fmt.Sprintf(
			"id != '%s' && server_id = '%s' && terminal_status = '' && phase != '%s'",
			escapePBFilterValue(record.Id),
			escapePBFilterValue(normalizeDeployServerID(record.GetString("server_id"))),
			escapePBFilterValue(string(model.OperationPhaseQueued)),
		)
		activeRecords, err := txApp.FindRecordsByFilter(col, filter, "", 1, 0)
		if err != nil {
			return err
		}
		if len(activeRecords) > 0 {
			claimed = nil
			return nil
		}

		now := time.Now()
		record.Set("phase", string(model.OperationPhaseValidating))
		if record.GetDateTime("started_at").IsZero() {
			record.Set("started_at", now)
		}
		if err := txApp.Save(record); err != nil {
			return err
		}

		pipelineRunID := record.GetString("pipeline_run")
		if pipelineRunID != "" {
			pipelineRun, err := txApp.FindRecordById("pipeline_runs", pipelineRunID)
			if err != nil {
				return err
			}
			pipelineRun.Set("status", "active")
			pipelineRun.Set("current_phase", string(model.PipelinePhaseValidating))
			if pipelineRun.GetDateTime("started_at").IsZero() {
				pipelineRun.Set("started_at", now)
			}
			if err := txApp.Save(pipelineRun); err != nil {
				return err
			}
		}

		claimed = record
		return nil
	})
	if err != nil {
		return nil, err
	}
	return claimed, nil
}

func (w *Worker) loadLifecycleExecutionContext(operationID string) (*lifecycleExecutionContext, error) {
	executionContext, err := orchestration.LoadExecutionContext(w.app, operationID)
	if err != nil {
		return nil, err
	}
	return &lifecycleExecutionContext{
		ExecutionContext: executionContext,
	}, nil
}

func (w *Worker) executeNode(ctx context.Context, execCtx *lifecycleExecutionContext, nodeRun *core.Record, node model.NodeDefinition) error {
	if isOperationCancellationRequested(execCtx.Operation) {
		return errOperationCancelled
	}
	result, err := lifecycleruntime.ExecuteNode(
		ctx,
		execCtx.Operation,
		node,
		w.executorFor(execCtx),
		execCtx.docker,
		lifecycleruntime.NodeExecutionHooks{
			Logf: func(line string) {
				appendOperationLog(w.app, execCtx.Operation, line)
			},
			HealthCheck: operationHealthCheck,
		},
	)
	if err != nil {
		return err
	}
	if result.DockerClient != nil {
		execCtx.docker = result.DockerClient
	}
	if result.OperationChanged {
		return w.app.Save(execCtx.Operation)
	}
	return nil
}

func (w *Worker) finishOperationSucceeded(execCtx *lifecycleExecutionContext) error {
	now := time.Now()
	releaseRecord, err := w.createReleaseBaseline(execCtx, now)
	if err != nil {
		return w.finishOperationFailed(execCtx, nil, model.NodeDefinition{Key: "release_baseline", DisplayName: "Create Release Baseline", NodeType: "runtime_config", Phase: string(model.PipelinePhaseVerifying)}, err)
	}

	execCtx.Operation.Set("terminal_status", "success")
	execCtx.Operation.Set("failure_reason", "")
	execCtx.Operation.Set("app_outcome", "new_release_active")
	execCtx.Operation.Set("error_message", "")
	execCtx.Operation.Set("result_release", releaseRecord.Id)
	execCtx.Operation.Set("ended_at", now)
	if err := w.app.Save(execCtx.Operation); err != nil {
		return err
	}

	execCtx.Pipeline.Set("status", "completed")
	execCtx.Pipeline.Set("ended_at", now)
	if err := w.app.Save(execCtx.Pipeline); err != nil {
		return err
	}

	execCtx.AppRecord.Set("current_release", releaseRecord.Id)
	projection.ApplyOperationSucceeded(execCtx.AppRecord, execCtx.Operation, now)
	if err := w.app.Save(execCtx.AppRecord); err != nil {
		return err
	}

	appendOperationLog(w.app, execCtx.Operation, "operation finished successfully")
	userID, userEmail := w.operationActor(execCtx.Operation)
	audit.Write(w.app, audit.Entry{
		UserID:       userID,
		UserEmail:    userEmail,
		Action:       "operation.run",
		ResourceType: "app_operation",
		ResourceID:   execCtx.Operation.Id,
		ResourceName: execCtx.Operation.GetString("compose_project_name"),
		Status:       audit.StatusSuccess,
	})
	return nil
}

func (w *Worker) finishOperationFailed(execCtx *lifecycleExecutionContext, nodeRun *core.Record, node model.NodeDefinition, runErr error) error {
	now := time.Now()
	message := strings.TrimSpace(runErr.Error())
	if message == "" {
		message = "operation failed"
	}

	if nodeRun != nil {
		nodeRun.Set("status", "failed")
		nodeRun.Set("error_message", message)
		nodeRun.Set("ended_at", now)
		if err := w.app.Save(nodeRun); err != nil {
			return err
		}
	}

	execCtx.Pipeline.Set("status", "failed")
	execCtx.Pipeline.Set("failed_node_key", node.Key)
	execCtx.Pipeline.Set("ended_at", now)
	if err := w.app.Save(execCtx.Pipeline); err != nil {
		return err
	}

	execCtx.Operation.Set("terminal_status", "failed")
	execCtx.Operation.Set("failure_reason", failureReasonForNode(node))
	execCtx.Operation.Set("app_outcome", operationFailureOutcome(execCtx.AppRecord))
	execCtx.Operation.Set("error_message", message)
	execCtx.Operation.Set("ended_at", now)
	if err := w.app.Save(execCtx.Operation); err != nil {
		return err
	}

	projection.ApplyOperationFailed(execCtx.AppRecord, execCtx.Operation)
	if err := w.app.Save(execCtx.AppRecord); err != nil {
		return err
	}

	appendOperationLog(w.app, execCtx.Operation, "operation failed: "+message)
	userID, userEmail := w.operationActor(execCtx.Operation)
	audit.Write(w.app, audit.Entry{
		UserID:       userID,
		UserEmail:    userEmail,
		Action:       "operation.run",
		ResourceType: "app_operation",
		ResourceID:   execCtx.Operation.Id,
		ResourceName: execCtx.Operation.GetString("compose_project_name"),
		Status:       audit.StatusFailed,
		Detail: map[string]any{
			"errorMessage": message,
			"failedNode":   node.Key,
		},
	})
	return runErr
}

func (w *Worker) finishOperationCancelled(execCtx *lifecycleExecutionContext, nodeRun *core.Record, message string) error {
	now := time.Now()
	if strings.TrimSpace(message) == "" {
		message = "operation cancelled"
	}

	if nodeRun != nil {
		nodeRun.Set("status", "cancelled")
		nodeRun.Set("error_message", message)
		nodeRun.Set("ended_at", now)
		if err := w.app.Save(nodeRun); err != nil {
			return err
		}
	}

	for _, pendingNode := range execCtx.NodeRuns {
		if pendingNode.GetString("status") != "pending" {
			continue
		}
		pendingNode.Set("status", "cancelled")
		pendingNode.Set("error_message", message)
		pendingNode.Set("ended_at", now)
		if err := w.app.Save(pendingNode); err != nil {
			return err
		}
	}

	if execCtx.docker != nil {
		if output, err := execCtx.docker.ComposeDown(context.Background(), execCtx.Operation.GetString("project_dir"), false); err == nil {
			if output != "" {
				appendOperationLog(w.app, execCtx.Operation, "docker compose down output:\n"+output)
			}
		} else {
			appendOperationLog(w.app, execCtx.Operation, "docker compose down failed during cancel: "+err.Error())
		}
	}

	execCtx.Pipeline.Set("status", "cancelled")
	execCtx.Pipeline.Set("ended_at", now)
	if err := w.app.Save(execCtx.Pipeline); err != nil {
		return err
	}

	execCtx.Operation.Set("terminal_status", "cancelled")
	execCtx.Operation.Set("app_outcome", operationFailureOutcome(execCtx.AppRecord))
	execCtx.Operation.Set("error_message", message)
	execCtx.Operation.Set("ended_at", now)
	if err := w.app.Save(execCtx.Operation); err != nil {
		return err
	}

	projection.ApplyOperationCancelled(execCtx.AppRecord, execCtx.Operation)
	if err := w.app.Save(execCtx.AppRecord); err != nil {
		return err
	}

	appendOperationLog(w.app, execCtx.Operation, message)
	userID, userEmail := w.operationActor(execCtx.Operation)
	audit.Write(w.app, audit.Entry{
		UserID:       userID,
		UserEmail:    userEmail,
		Action:       "operation.cancel",
		ResourceType: "app_operation",
		ResourceID:   execCtx.Operation.Id,
		ResourceName: execCtx.Operation.GetString("compose_project_name"),
		Status:       audit.StatusSuccess,
	})
	return nil
}

func (w *Worker) createReleaseBaseline(execCtx *lifecycleExecutionContext, now time.Time) (*core.Record, error) {
	releasesCol, err := w.app.FindCollectionByNameOrId("app_releases")
	if err != nil {
		return nil, err
	}

	activeReleases, err := w.app.FindRecordsByFilter(
		releasesCol,
		fmt.Sprintf("app = '%s' && is_active = true", escapePBFilterValue(execCtx.AppRecord.Id)),
		"-created",
		20,
		0,
	)
	if err != nil {
		return nil, err
	}

	for _, active := range activeReleases {
		active.Set("is_active", false)
		active.Set("is_last_known_good", false)
		active.Set("release_role", "historical")
		active.Set("superseded_at", now)
		if err := w.app.Save(active); err != nil {
			return nil, err
		}
		if execCtx.Operation.GetString("baseline_release") == "" {
			execCtx.Operation.Set("baseline_release", active.Id)
		}
	}

	release := core.NewRecord(releasesCol)
	release.Set("app", execCtx.AppRecord.Id)
	release.Set("created_by_operation", execCtx.Operation.Id)
	release.Set("release_role", "active")
	release.Set("version_label", buildReleaseVersionLabel(execCtx.Operation, now))
	release.Set("source_type", releaseSourceType(execCtx.Operation.GetString("trigger_source")))
	release.Set("source_ref", "operation://"+execCtx.Operation.Id)
	release.Set("rendered_compose", execCtx.Operation.GetString("rendered_compose"))
	release.Set("resolved_env_json", execCtx.Operation.Get("resolved_env_json"))
	release.Set("is_active", true)
	release.Set("is_last_known_good", true)
	release.Set("activated_at", now)
	if err := w.app.Save(release); err != nil {
		return nil, err
	}

	return release, nil
}

func (w *Worker) executorFor(execCtx *lifecycleExecutionContext) lifecycleruntime.Executor {
	if execCtx.executor == nil {
		execCtx.executor = operationExecutorFactory(w.app, normalizeDeployServerID(execCtx.Operation.GetString("server_id")))
	}
	return execCtx.executor
}

func (w *Worker) dockerClientFor(execCtx *lifecycleExecutionContext) (*docker.Client, error) {
	if execCtx.docker != nil {
		return execCtx.docker, nil
	}
	client, err := w.executorFor(execCtx).DockerClient()
	if err != nil {
		return nil, err
	}
	execCtx.docker = client
	return client, nil
}

func (w *Worker) operationActor(operation *core.Record) (string, string) {
	if operation == nil {
		return "", ""
	}
	userID := strings.TrimSpace(operation.GetString("requested_by"))
	if userID == "" {
		return "", ""
	}
	user, err := w.app.FindRecordById("users", userID)
	if err != nil {
		return userID, ""
	}
	return userID, user.GetString("email")
}

func appendOperationLog(app core.App, record *core.Record, line string) {
	if record == nil || strings.TrimSpace(line) == "" {
		return
	}
	current := record.GetString("execution_log")
	entry := time.Now().UTC().Format(time.RFC3339) + " " + line
	if current == "" {
		current = entry
	} else {
		current += "\n" + entry
	}
	truncated := false
	if len(current) > deploy.MaxExecutionLogBytes {
		current = current[len(current)-deploy.MaxExecutionLogBytes:]
		if idx := strings.IndexByte(current, '\n'); idx >= 0 && idx < len(current)-1 {
			current = current[idx+1:]
		}
		truncated = true
	}
	record.Set("execution_log", current)
	record.Set("execution_log_truncated", record.GetBool("execution_log_truncated") || truncated)
	record.Set("log_cursor", map[string]any{"bytes": len(current)})
	if err := app.Save(record); err != nil {
		log.Printf("appendOperationLog: save operation %s: %v", record.Id, err)
	}
}

func isOperationCancellationRequested(record *core.Record) bool {
	if record == nil {
		return false
	}
	return !record.GetDateTime("cancel_requested_at").IsZero()
}

func failureReasonForNode(node model.NodeDefinition) string {
	switch node.NodeType {
	case "validation":
		return "validation_error"
	case "health_check":
		return "verification_failed"
	default:
		return "execution_error"
	}
}

func operationFailureOutcome(appRecord *core.Record) string {
	if appRecord == nil || strings.TrimSpace(appRecord.GetString("current_release")) == "" {
		return "no_healthy_release"
	}
	return "previous_release_active"
}

func buildReleaseVersionLabel(operation *core.Record, now time.Time) string {
	projectName := strings.TrimSpace(operation.GetString("compose_project_name"))
	if projectName == "" {
		projectName = "app"
	}
	return fmt.Sprintf("%s-%s", projectName, now.UTC().Format("20060102-150405"))
}

func releaseSourceType(triggerSource string) string {
	switch strings.TrimSpace(triggerSource) {
	case string(model.TriggerSourceGitOps):
		return "git"
	case string(model.TriggerSourceFileOps):
		return "file"
	case string(model.TriggerSourceStore):
		return "template"
	default:
		return "manual"
	}
}

func escapePBFilterValue(value string) string {
	return strings.ReplaceAll(value, "'", "\\'")
}
