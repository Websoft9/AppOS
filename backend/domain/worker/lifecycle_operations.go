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
	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/domain/deploy"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
	"github.com/websoft9/appos/backend/domain/lifecycle/orchestration"
	"github.com/websoft9/appos/backend/domain/lifecycle/projection"
	lifecycleruntime "github.com/websoft9/appos/backend/domain/lifecycle/runtime"
	"github.com/websoft9/appos/backend/infra/docker"
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
	executor lifecycleruntime.Executor
	docker   *docker.Client
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
	w.stateMu.Lock()
	w.schedulerRunning = true
	w.schedulerLastTick = time.Now().UTC()
	w.stateMu.Unlock()
	w.backgroundWG.Add(1)
	go func() {
		defer w.backgroundWG.Done()
		if err := w.dispatchQueuedOperations(); err != nil {
			w.stateMu.Lock()
			w.lastDispatchError = err.Error()
			w.stateMu.Unlock()
			log.Printf("dispatch queued operations: %v", err)
		}

		ticker := time.NewTicker(lifecycleSchedulerInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				w.stateMu.Lock()
				w.schedulerRunning = false
				w.stateMu.Unlock()
				return
			case <-ticker.C:
				w.stateMu.Lock()
				w.schedulerLastTick = time.Now().UTC()
				w.stateMu.Unlock()
				if err := w.dispatchQueuedOperations(); err != nil {
					w.stateMu.Lock()
					w.lastDispatchError = err.Error()
					w.stateMu.Unlock()
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
	w.stateMu.Lock()
	w.lastDispatchAt = time.Now().UTC()
	w.lastDispatchError = ""
	w.stateMu.Unlock()

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
			appendNodeRunLog(w.app, nodeRun, "step started: "+node.DisplayName)
		},
		OnNodeCompleted: func(runCtx *orchestration.ExecutionContext, nodeRun *core.Record) {
			execCtx.ExecutionContext = runCtx
			appendOperationLog(w.app, execCtx.Operation, "step completed: "+nodeRun.GetString("display_name"))
			appendNodeRunLog(w.app, nodeRun, "step completed: "+nodeRun.GetString("display_name"))
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
	switch node.NodeType {
	case "release_candidate":
		releaseRecord, operationChanged, err := w.createOrUpdateCandidateRelease(execCtx, time.Now())
		if err != nil {
			return err
		}
		if releaseRecord != nil {
			appendOperationLog(w.app, execCtx.Operation, "candidate release recorded: "+releaseRecord.Id)
			appendNodeRunLog(w.app, nodeRun, "candidate release recorded: "+releaseRecord.Id)
		}
		if operationChanged {
			return w.app.Save(execCtx.Operation)
		}
		return nil
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
				appendNodeRunLog(w.app, nodeRun, line)
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
	var releaseRecord *core.Record
	if shouldCreateReleaseBaseline(execCtx.Operation) {
		var err error
		if strings.TrimSpace(execCtx.Operation.GetString("candidate_release")) != "" {
			releaseRecord, err = w.promoteCandidateRelease(execCtx, now)
		} else {
			releaseRecord, err = w.createReleaseBaseline(execCtx, now)
		}
		if err != nil {
			return w.finishOperationFailed(execCtx, nil, model.NodeDefinition{Key: "release_baseline", DisplayName: "Create Release Baseline", NodeType: "runtime_config", Phase: string(model.PipelinePhaseVerifying)}, err)
		}
	}

	execCtx.Operation.Set("terminal_status", "success")
	execCtx.Operation.Set("failure_reason", "")
	execCtx.Operation.Set("app_outcome", operationSuccessOutcome(execCtx.AppRecord, execCtx.Operation))
	execCtx.Operation.Set("error_message", "")
	if releaseRecord != nil {
		execCtx.Operation.Set("result_release", releaseRecord.Id)
	} else {
		execCtx.Operation.Set("result_release", "")
	}
	execCtx.Operation.Set("ended_at", now)
	if err := w.app.Save(execCtx.Operation); err != nil {
		return err
	}

	execCtx.Pipeline.Set("status", "completed")
	execCtx.Pipeline.Set("ended_at", now)
	if err := w.app.Save(execCtx.Pipeline); err != nil {
		return err
	}

	if releaseRecord != nil {
		execCtx.AppRecord.Set("current_release", releaseRecord.Id)
	}
	projection.ApplyOperationSucceeded(execCtx.AppRecord, execCtx.Operation, now)
	if strings.TrimSpace(execCtx.Operation.GetString("operation_type")) == string(model.OperationTypeUninstall) {
		if err := w.deactivateActiveReleases(execCtx, now); err != nil {
			return err
		}
	}
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

func (w *Worker) createOrUpdateCandidateRelease(execCtx *lifecycleExecutionContext, now time.Time) (*core.Record, bool, error) {
	if execCtx == nil || execCtx.Operation == nil || execCtx.AppRecord == nil {
		return nil, false, fmt.Errorf("execution context is incomplete")
	}

	publicationResult, ok := operationSourceBuildNestedMap(execCtx.Operation, "publication_result")
	if !ok {
		return nil, false, fmt.Errorf("source_build.publication_result is required before creating candidate release")
	}

	releasesCol, err := w.app.FindCollectionByNameOrId("app_releases")
	if err != nil {
		return nil, false, err
	}

	candidateID := strings.TrimSpace(execCtx.Operation.GetString("candidate_release"))
	var releaseRecord *core.Record
	if candidateID != "" {
		releaseRecord, err = w.app.FindRecordById("app_releases", candidateID)
		if err != nil {
			return nil, false, err
		}
	} else {
		releaseRecord = core.NewRecord(releasesCol)
	}

	releaseRecord.Set("app", execCtx.AppRecord.Id)
	releaseRecord.Set("created_by_operation", execCtx.Operation.Id)
	releaseRecord.Set("release_role", "candidate")
	releaseRecord.Set("version_label", candidateReleaseVersionLabel(execCtx.Operation, now))
	releaseRecord.Set("source_type", candidateReleaseSourceType(execCtx.Operation))
	releaseRecord.Set("source_ref", candidateReleaseSourceRef(execCtx.Operation))
	releaseRecord.Set("rendered_compose", execCtx.Operation.GetString("rendered_compose"))
	releaseRecord.Set("resolved_env_json", execCtx.Operation.Get("resolved_env_json"))
	releaseRecord.Set("artifact_digest", candidateReleaseArtifactDigest(publicationResult))
	releaseRecord.Set("is_active", false)
	releaseRecord.Set("is_last_known_good", false)
	releaseRecord.Set("notes", candidateReleaseNotes(execCtx.Operation, publicationResult))
	if err := w.app.Save(releaseRecord); err != nil {
		return nil, false, err
	}

	operationChanged := false
	if execCtx.Operation.GetString("candidate_release") != releaseRecord.Id {
		execCtx.Operation.Set("candidate_release", releaseRecord.Id)
		operationChanged = true
	}
	return releaseRecord, operationChanged, nil
}

func (w *Worker) promoteCandidateRelease(execCtx *lifecycleExecutionContext, now time.Time) (*core.Record, error) {
	if execCtx == nil || execCtx.Operation == nil || execCtx.AppRecord == nil {
		return nil, fmt.Errorf("execution context is incomplete")
	}
	candidateID := strings.TrimSpace(execCtx.Operation.GetString("candidate_release"))
	if candidateID == "" {
		return nil, fmt.Errorf("candidate_release is required")
	}

	releaseRecord, err := w.app.FindRecordById("app_releases", candidateID)
	if err != nil {
		return nil, err
	}

	activeReleases, err := w.app.FindRecordsByFilter(
		releaseRecord.Collection(),
		fmt.Sprintf("app = '%s' && is_active = true && id != '%s'", escapePBFilterValue(execCtx.AppRecord.Id), escapePBFilterValue(releaseRecord.Id)),
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

	releaseRecord.Set("release_role", "active")
	releaseRecord.Set("rendered_compose", execCtx.Operation.GetString("rendered_compose"))
	releaseRecord.Set("resolved_env_json", execCtx.Operation.Get("resolved_env_json"))
	releaseRecord.Set("is_active", true)
	releaseRecord.Set("is_last_known_good", true)
	releaseRecord.Set("activated_at", now)
	releaseRecord.Set("superseded_at", nil)
	if err := w.app.Save(releaseRecord); err != nil {
		return nil, err
	}
	return releaseRecord, nil
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

func appendNodeRunLog(app core.App, record *core.Record, line string) {
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
	if err := app.Save(record); err != nil {
		log.Printf("appendNodeRunLog: save node run %s: %v", record.Id, err)
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
	case "health_check", "runtime_check":
		return "verification_failed"
	default:
		return "execution_error"
	}
}

func (w *Worker) deactivateActiveReleases(execCtx *lifecycleExecutionContext, now time.Time) error {
	if execCtx == nil || execCtx.AppRecord == nil {
		return nil
	}
	releasesCol, err := w.app.FindCollectionByNameOrId("app_releases")
	if err != nil {
		return err
	}
	records, err := w.app.FindRecordsByFilter(
		releasesCol,
		fmt.Sprintf("app = '%s' && is_active = true", escapePBFilterValue(execCtx.AppRecord.Id)),
		"-created",
		50,
		0,
	)
	if err != nil {
		return err
	}
	for _, release := range records {
		release.Set("is_active", false)
		release.Set("is_last_known_good", false)
		release.Set("release_role", "historical")
		release.Set("superseded_at", now)
		if err := w.app.Save(release); err != nil {
			return err
		}
	}
	return nil
}

func operationFailureOutcome(appRecord *core.Record) string {
	if appRecord == nil || strings.TrimSpace(appRecord.GetString("current_release")) == "" {
		return "no_healthy_release"
	}
	return "previous_release_active"
}

func operationSuccessOutcome(appRecord, operation *core.Record) string {
	if operation == nil {
		return operationFailureOutcome(appRecord)
	}
	switch strings.TrimSpace(operation.GetString("operation_type")) {
	case string(model.OperationTypeUninstall):
		return "no_healthy_release"
	case string(model.OperationTypeInstall), string(model.OperationTypeUpgrade), string(model.OperationTypeRedeploy), string(model.OperationTypeReconfigure), string(model.OperationTypeRecover), string(model.OperationTypeRollback), string(model.OperationTypeRestore):
		return "new_release_active"
	default:
		return operationFailureOutcome(appRecord)
	}
}

func shouldCreateReleaseBaseline(operation *core.Record) bool {
	if operation == nil {
		return false
	}
	switch strings.TrimSpace(operation.GetString("operation_type")) {
	case string(model.OperationTypeInstall), string(model.OperationTypeUpgrade), string(model.OperationTypeRedeploy), string(model.OperationTypeReconfigure), string(model.OperationTypeRecover), string(model.OperationTypeRollback), string(model.OperationTypeRestore):
		return true
	default:
		return false
	}
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

func candidateReleaseVersionLabel(operation *core.Record, now time.Time) string {
	metadata, ok := operationSourceBuildNestedMap(operation, "release_metadata")
	if ok {
		if versionLabel := mapStringValue(metadata, "version_label"); versionLabel != "" {
			return versionLabel
		}
	}
	return buildReleaseVersionLabel(operation, now)
}

func candidateReleaseSourceType(operation *core.Record) string {
	sourceKind := strings.ToLower(operationSourceBuildString(operation, "source_kind"))
	switch sourceKind {
	case "git":
		return "git"
	case "uploaded-package":
		return "file"
	default:
		return releaseSourceType(operation.GetString("trigger_source"))
	}
}

func candidateReleaseSourceRef(operation *core.Record) string {
	if sourceRef := operationSourceBuildString(operation, "source_ref"); sourceRef != "" {
		return sourceRef
	}
	return "operation://" + operation.Id
}

func candidateReleaseArtifactDigest(publicationResult map[string]any) string {
	artifactDigest := mapStringValue(publicationResult, "artifact_digest")
	if artifactDigest != "" {
		return artifactDigest
	}
	imageName := mapStringValue(publicationResult, "image_name")
	if imageName == "" {
		return ""
	}
	imageTag := mapStringValue(publicationResult, "image_tag")
	if imageTag == "" {
		imageTag = "candidate"
	}
	return imageName + ":" + imageTag
}

func candidateReleaseNotes(operation *core.Record, publicationResult map[string]any) string {
	metadata, _ := operationSourceBuildNestedMap(operation, "release_metadata")
	parts := make([]string, 0, 3)
	if sourceLabel := mapStringValue(metadata, "source_label"); sourceLabel != "" {
		parts = append(parts, sourceLabel)
	}
	if changeSummary := mapStringValue(metadata, "change_summary"); changeSummary != "" {
		parts = append(parts, changeSummary)
	}
	if localImageRef := mapStringValue(publicationResult, "local_image_ref"); localImageRef != "" {
		parts = append(parts, "image="+localImageRef)
	}
	if serviceName := sourceBuildDeployTargetService(operation); serviceName != "" {
		parts = append(parts, "service="+serviceName)
	}
	if targetRef := mapStringValue(publicationResult, "target_ref"); targetRef != "" {
		parts = append(parts, "target="+targetRef)
	}
	return strings.Join(parts, " | ")
}

func sourceBuildDeployTargetService(operation *core.Record) string {
	deployInputs, ok := operationSourceBuildNestedMap(operation, "deploy_inputs")
	if !ok {
		return ""
	}
	if serviceName := mapStringValue(deployInputs, "service_name"); serviceName != "" {
		return serviceName
	}
	return mapStringValue(deployInputs, "target_service")
}

func operationSpecMap(operation *core.Record) (map[string]any, bool) {
	if operation == nil {
		return nil, false
	}
	raw := operation.Get("spec_json")
	spec, ok := raw.(map[string]any)
	if ok {
		return spec, true
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return nil, false
	}
	if err := json.Unmarshal(encoded, &spec); err != nil {
		return nil, false
	}
	return spec, true
}

func operationSourceBuildString(operation *core.Record, key string) string {
	value, ok := operationSourceBuildValue(operation, key)
	if !ok {
		return ""
	}
	stringValue, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(stringValue)
}

func operationSourceBuildValue(operation *core.Record, key string) (any, bool) {
	if operation == nil || strings.TrimSpace(key) == "" {
		return nil, false
	}
	spec, ok := operationSpecMap(operation)
	if !ok {
		return nil, false
	}
	sourceBuild, ok := spec["source_build"].(map[string]any)
	if !ok {
		return nil, false
	}
	value, ok := sourceBuild[key]
	if !ok {
		return nil, false
	}
	return value, true
}

func operationSourceBuildNestedMap(operation *core.Record, key string) (map[string]any, bool) {
	value, ok := operationSourceBuildValue(operation, key)
	if !ok {
		return nil, false
	}
	direct, ok := value.(map[string]any)
	if ok {
		return direct, true
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, false
	}
	var parsed map[string]any
	if err := json.Unmarshal(encoded, &parsed); err != nil {
		return nil, false
	}
	return parsed, true
}

func mapStringValue(values map[string]any, key string) string {
	if len(values) == 0 || strings.TrimSpace(key) == "" {
		return ""
	}
	value, ok := values[key]
	if !ok {
		return ""
	}
	stringValue, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(stringValue)
}

func escapePBFilterValue(value string) string {
	return strings.ReplaceAll(value, "'", "\\'")
}
