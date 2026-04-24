// Package worker manages the embedded Asynq task worker.
//
// The worker runs as a goroutine inside the PocketBase process,
// connecting to Redis for persistent async task processing.
package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/domain/deploy"
	lifecycleruntime "github.com/websoft9/appos/backend/domain/lifecycle/runtime"
)

const (
	// Task type constants
	TaskDeployApp     = "deploy:app"
	TaskRestartApp    = "restart:app"
	TaskStopApp       = "stop:app"
	TaskDeleteApp     = "delete:app"
	TaskBackupCreate  = "backup:create"
	TaskBackupRestore = "backup:restore"
)

// ─── Payload Structs ─────────────────────────────────────
// Each payload struct must carry UserID + UserEmail so the worker can write
// audit records attributed to the originating user.

// DeployAppPayload is the task payload for TaskDeployApp.
type DeployAppPayload struct {
	UserID       string `json:"user_id"`
	UserEmail    string `json:"user_email"`
	DeploymentID string `json:"deployment_id"`
}

// RestartAppPayload is the task payload for TaskRestartApp.
type RestartAppPayload struct {
	UserID     string `json:"user_id"`
	UserEmail  string `json:"user_email"`
	ProjectDir string `json:"project_dir"`
}

// StopAppPayload is the task payload for TaskStopApp.
type StopAppPayload struct {
	UserID     string `json:"user_id"`
	UserEmail  string `json:"user_email"`
	ProjectDir string `json:"project_dir"`
}

// DeleteAppPayload is the task payload for TaskDeleteApp.
type DeleteAppPayload struct {
	UserID        string `json:"user_id"`
	UserEmail     string `json:"user_email"`
	ProjectDir    string `json:"project_dir"`
	RemoveVolumes bool   `json:"remove_volumes"`
}

// BackupCreatePayload is the task payload for TaskBackupCreate.
type BackupCreatePayload struct {
	UserID    string `json:"user_id"`
	UserEmail string `json:"user_email"`
	Name      string `json:"name"`
}

// BackupRestorePayload is the task payload for TaskBackupRestore.
type BackupRestorePayload struct {
	UserID    string `json:"user_id"`
	UserEmail string `json:"user_email"`
	Name      string `json:"name"`
}

// ─── Worker ──────────────────────────────────────────────

// Worker manages the Asynq server and a shared client for enqueuing tasks.
type Worker struct {
	server            *asynq.Server
	client            *asynq.Client
	app               core.App // PocketBase app for audit writes
	schedulerCancel   context.CancelFunc
	backgroundWG      sync.WaitGroup
	stateMu           sync.RWMutex
	startedAt         time.Time
	serverRunning     bool
	schedulerRunning  bool
	schedulerLastTick time.Time
	lastDispatchAt    time.Time
	lastServerError   string
	lastDispatchError string
}

type Snapshot struct {
	StartedAt         time.Time
	ServerRunning     bool
	SchedulerRunning  bool
	SchedulerLastTick time.Time
	LastDispatchAt    time.Time
	LastServerError   string
	LastDispatchError string
}

var deployServerLocks = struct {
	mu    sync.Mutex
	locks map[string]*sync.Mutex
}{
	locks: map[string]*sync.Mutex{},
}

// New creates a Worker with Asynq server and shared client.
// app is the PocketBase core.App used for audit writes inside task handlers.
// Call Start() to begin processing and Shutdown() to stop.
func New(app core.App) *Worker {
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}

	opt := asynq.RedisClientOpt{Addr: redisAddr}

	srv := asynq.NewServer(opt, asynq.Config{
		Concurrency: 10,
		Queues: map[string]int{
			"critical": 6,
			"default":  3,
			"low":      1,
		},
	})

	client := asynq.NewClient(opt)

	return &Worker{
		server: srv,
		client: client,
		app:    app,
	}
}

// Start begins processing tasks in a background goroutine.
// This should be called only once during the application lifecycle.
func (w *Worker) Start() {
	w.stateMu.Lock()
	if w.startedAt.IsZero() {
		w.startedAt = time.Now().UTC()
	}
	w.serverRunning = true
	w.stateMu.Unlock()

	if err := w.recoverOrphanedDeployments(); err != nil {
		log.Printf("recover orphaned deployments: %v", err)
	}
	if err := w.recoverOrphanedOperations(); err != nil {
		log.Printf("recover orphaned operations: %v", err)
	}

	mux := asynq.NewServeMux()
	mux.HandleFunc(TaskDeployApp, w.handleDeployApp)
	mux.HandleFunc(TaskMonitorAppHealthSweep, w.handleMonitorAppHealthSweep)
	mux.HandleFunc(TaskMonitorCredentialSweep, w.handleMonitorCredentialSweep)
	mux.HandleFunc(TaskMonitorHeartbeatFreshness, w.handleMonitorHeartbeatFreshness)
	mux.HandleFunc(TaskMonitorReachabilitySweep, w.handleMonitorReachabilitySweep)
	mux.HandleFunc(TaskRunOperation, w.handleRunOperation)
	mux.HandleFunc(TaskRestartApp, w.handleRestartApp)
	mux.HandleFunc(TaskStopApp, w.handleStopApp)
	mux.HandleFunc(TaskDeleteApp, w.handleDeleteApp)
	mux.HandleFunc(TaskBackupCreate, w.handleBackupCreate)
	mux.HandleFunc(TaskBackupRestore, w.handleBackupRestore)
	mux.HandleFunc(TaskSoftwareInstall, w.handleSoftwareAction)
	mux.HandleFunc(TaskSoftwareUpgrade, w.handleSoftwareAction)
	mux.HandleFunc(TaskSoftwareVerify, w.handleSoftwareAction)
	mux.HandleFunc(TaskSoftwareRepair, w.handleSoftwareAction)
	w.startLifecycleScheduler()

	go func() {
		if err := w.server.Run(mux); err != nil {
			w.stateMu.Lock()
			w.serverRunning = false
			w.lastServerError = err.Error()
			w.stateMu.Unlock()
			log.Printf("asynq worker error: %v", err)
			return
		}
		w.stateMu.Lock()
		w.serverRunning = false
		w.stateMu.Unlock()
	}()
}

// Client returns the shared Asynq client for enqueuing tasks.
func (w *Worker) Client() *asynq.Client {
	return w.client
}

// Shutdown gracefully stops the worker and closes the client connection.
func (w *Worker) Shutdown() {
	w.stateMu.Lock()
	w.serverRunning = false
	w.schedulerRunning = false
	w.stateMu.Unlock()
	if w.schedulerCancel != nil {
		w.schedulerCancel()
	}
	w.server.Shutdown()
	w.backgroundWG.Wait()
	_ = w.client.Close()
}

func (w *Worker) Snapshot() Snapshot {
	w.stateMu.RLock()
	defer w.stateMu.RUnlock()
	return Snapshot{
		StartedAt:         w.startedAt,
		ServerRunning:     w.serverRunning,
		SchedulerRunning:  w.schedulerRunning,
		SchedulerLastTick: w.schedulerLastTick,
		LastDispatchAt:    w.lastDispatchAt,
		LastServerError:   w.lastServerError,
		LastDispatchError: w.lastDispatchError,
	}
}

// ─── Task Handlers ───────────────────────────────────────
// All handlers follow the pattern:
//   1. Unmarshal payload (includes UserID/UserEmail for audit)
//   2. Execute the operation (TODO stubs — to be implemented per epic)
//   3. Write audit success or failed

func (w *Worker) handleDeployApp(_ context.Context, t *asynq.Task) error {
	var p DeployAppPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		log.Printf("handleDeployApp: unmarshal payload: %v", err)
		return err
	}
	if p.DeploymentID == "" {
		return fmt.Errorf("deployment_id is required")
	}

	record, err := w.claimQueuedDeployment(p.DeploymentID)
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
	appendDeploymentLog(w.app, record, "job accepted by worker")
	appendDeploymentLog(w.app, record, "validation started")

	rawSpec := record.Get("spec")
	data, err := json.Marshal(rawSpec)
	if err != nil {
		return markDeploymentFailed(w.app, record, p, "invalid deployment spec")
	}

	var spec deploy.DeploymentSpec
	if err := json.Unmarshal(data, &spec); err != nil {
		appendDeploymentLog(w.app, record, "failed to decode deployment spec")
		return markDeploymentFailed(w.app, record, p, "invalid deployment spec")
	}
	if err := deploy.ValidateManualCompose(spec.RenderedCompose); err != nil {
		appendDeploymentLog(w.app, record, "compose validation failed: "+err.Error())
		return markDeploymentFailed(w.app, record, p, err.Error())
	}
	appendDeploymentLog(w.app, record, "compose validation passed")
	if err := deploy.ApplyEventToRecord(w.app, record, deploy.EventPreparationStarted, deploy.TransitionOptions{}); err != nil {
		return err
	}

	projectDir := record.GetString("project_dir")
	if projectDir == "" {
		projectDir = filepath.Join("/appos/data/apps/deployments", record.Id)
		record.Set("project_dir", projectDir)
	}
	executor := lifecycleruntime.NewDeploymentExecutor(w.app, serverID)
	if err := executor.PrepareWorkspace(projectDir, spec.RenderedCompose); err != nil {
		appendDeploymentLog(w.app, record, "failed to prepare deployment workspace: "+err.Error())
		return markDeploymentFailed(w.app, record, p, "failed to prepare deployment workspace")
	}
	appendDeploymentLog(w.app, record, executor.Name()+" deployment workspace prepared: "+projectDir)

	if err := deploy.ApplyEventToRecord(w.app, record, deploy.EventExecutionStarted, deploy.TransitionOptions{}); err != nil {
		return err
	}
	appendDeploymentLog(w.app, record, "docker compose up started")

	client, err := executor.DockerClient()
	if err != nil {
		appendDeploymentLog(w.app, record, "failed to create docker client: "+err.Error())
		return markDeploymentFailed(w.app, record, p, "failed to connect target docker host")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	output, err := client.ComposeUp(ctx, projectDir)
	if err != nil {
		appendDeploymentLog(w.app, record, "docker compose up failed: "+err.Error())
		if cleanupOutput, cleanupErr := client.ComposeDown(context.Background(), projectDir, false); cleanupErr == nil && cleanupOutput != "" {
			appendDeploymentLog(w.app, record, "cleanup down output:\n"+cleanupOutput)
		} else if cleanupErr != nil {
			appendDeploymentLog(w.app, record, "cleanup down failed: "+cleanupErr.Error())
		}
		if isDeploymentTimeoutError(err) {
			return markDeploymentTimedOut(w.app, record, p, "deployment execution timed out")
		}
		return markDeploymentFailed(w.app, record, p, err.Error())
	}
	if output != "" {
		appendDeploymentLog(w.app, record, "docker compose up output:\n"+output)
	}
	if err := deploy.ApplyEventToRecord(w.app, record, deploy.EventVerificationStarted, deploy.TransitionOptions{}); err != nil {
		return err
	}
	appendDeploymentLog(w.app, record, "health check started")
	healthCtx, healthCancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer healthCancel()
	if err := lifecycleruntime.RunDeploymentHealthCheck(healthCtx, client, projectDir); err != nil {
		appendDeploymentLog(w.app, record, "health check failed: "+err.Error())
		if isDeploymentTimeoutError(err) {
			return markDeploymentTimedOut(w.app, record, p, "deployment verification timed out")
		}
		return markDeploymentFailed(w.app, record, p, "deployment health check failed")
	}
	appendDeploymentLog(w.app, record, "health check passed")

	if err := deploy.ApplyEventToRecord(w.app, record, deploy.EventDeploymentSucceeded, deploy.TransitionOptions{ClearErrorSummary: true}); err != nil {
		return err
	}
	if err := syncAppInstanceFromDeployment(w.app, record); err != nil {
		appendDeploymentLog(w.app, record, "failed to sync app instance: "+err.Error())
	}
	appendDeploymentLog(w.app, record, "deployment finished successfully")

	audit.Write(w.app, audit.Entry{
		UserID:       p.UserID,
		UserEmail:    p.UserEmail,
		Action:       "deploy.run",
		ResourceType: "deployment",
		ResourceID:   record.Id,
		ResourceName: record.GetString("compose_project_name"),
		Status:       audit.StatusSuccess,
	})
	return nil
}

func markDeploymentFailed(app core.App, record *core.Record, payload DeployAppPayload, message string) error {
	current := record.GetString("status")
	appendDeploymentLog(app, record, "deployment failed: "+message)
	if current != deploy.StatusFailed {
		event, err := deploy.FailureEventForStatus(current)
		if err != nil {
			return err
		}
		if err := deploy.ApplyEventToRecord(app, record, event, deploy.TransitionOptions{ErrorSummary: message}); err != nil {
			return err
		}
	} else {
		record.Set("error_summary", message)
		record.Set("finished_at", time.Now())
		if err := app.Save(record); err != nil {
			return err
		}
	}
	audit.Write(app, audit.Entry{
		UserID:       payload.UserID,
		UserEmail:    payload.UserEmail,
		Action:       "deploy.run",
		ResourceType: "deployment",
		ResourceID:   record.Id,
		ResourceName: record.GetString("compose_project_name"),
		Status:       audit.StatusFailed,
		Detail: map[string]any{
			"errorMessage": message,
		},
	})
	return errors.New(message)
}

func markDeploymentTimedOut(app core.App, record *core.Record, payload DeployAppPayload, message string) error {
	appendDeploymentLog(app, record, "deployment timed out: "+message)
	if err := deploy.ApplyEventToRecord(app, record, deploy.EventTimedOut, deploy.TransitionOptions{ErrorSummary: message}); err != nil {
		return err
	}
	audit.Write(app, audit.Entry{
		UserID:       payload.UserID,
		UserEmail:    payload.UserEmail,
		Action:       "deploy.run",
		ResourceType: "deployment",
		ResourceID:   record.Id,
		ResourceName: record.GetString("compose_project_name"),
		Status:       audit.StatusFailed,
		Detail: map[string]any{
			"errorMessage": message,
			"kind":         deploy.StatusTimeout,
		},
	})
	return errors.New(message)
}

func isDeploymentTimeoutError(err error) bool {
	return errors.Is(err, context.DeadlineExceeded)
}

func normalizeDeployServerID(serverID string) string {
	if serverID == "" {
		return "local"
	}
	return serverID
}

func deploymentServerLock(serverID string) *sync.Mutex {
	deployServerLocks.mu.Lock()
	defer deployServerLocks.mu.Unlock()
	if lock, ok := deployServerLocks.locks[serverID]; ok {
		return lock
	}
	lock := &sync.Mutex{}
	deployServerLocks.locks[serverID] = lock
	return lock
}

func (w *Worker) recoverOrphanedDeployments() error {
	col, err := w.app.FindCollectionByNameOrId("deployments")
	if err != nil {
		return nil
	}

	filter := activeDeploymentFilter()
	if filter == "" {
		return nil
	}

	records, err := w.app.FindRecordsByFilter(col, filter, "-updated", 500, 0)
	if err != nil {
		return err
	}

	for _, record := range records {
		current := record.GetString("status")
		if !deploy.IsActiveExecutionStatus(current) {
			continue
		}

		appendDeploymentLog(w.app, record, "worker startup detected orphaned deployment")
		event, err := deploy.FailureEventForStatus(current)
		if err != nil {
			return err
		}
		if err := deploy.ApplyEventToRecord(w.app, record, event, deploy.TransitionOptions{
			ErrorSummary: "deployment orphaned after worker restart",
		}); err != nil {
			return err
		}

		if deploymentHasReleaseSnapshot(record) {
			appendDeploymentLog(w.app, record, "release snapshot found during orphan recovery")
			if err := deploy.ApplyEventToRecord(w.app, record, deploy.EventRollbackStarted, deploy.TransitionOptions{}); err != nil {
				return err
			}
			appendDeploymentLog(w.app, record, "automatic rollback unavailable during orphan recovery")
			if err := deploy.ApplyEventToRecord(w.app, record, deploy.EventRollbackFailed, deploy.TransitionOptions{
				ErrorSummary: "deployment orphaned after worker restart; manual recovery required",
			}); err != nil {
				return err
			}
		}
	}

	return nil
}

func activeDeploymentFilter() string {
	statuses := deploy.ActiveExecutionStatuses()
	parts := make([]string, 0, len(statuses))
	for _, status := range statuses {
		parts = append(parts, fmt.Sprintf("status = \"%s\"", status))
	}
	return strings.Join(parts, " || ")
}

func (w *Worker) claimQueuedDeployment(deploymentID string) (*core.Record, error) {
	if _, err := w.app.FindCollectionByNameOrId("deployments"); err != nil {
		return nil, nil
	}

	var claimed *core.Record
	err := w.app.RunInTransaction(func(txApp core.App) error {
		record, err := txApp.FindRecordById("deployments", deploymentID)
		if err != nil {
			return fmt.Errorf("find deployment %s: %w", deploymentID, err)
		}
		if record.GetString("status") != deploy.StatusQueued {
			log.Printf("handleDeployApp: skip deployment %s in status %s", record.Id, record.GetString("status"))
			claimed = nil
			return nil
		}

		serverID := normalizeDeployServerID(record.GetString("server_id"))
		col, err := txApp.FindCollectionByNameOrId("deployments")
		if err != nil {
			return err
		}
		filter := fmt.Sprintf(
			`id != "%s" && server_id = "%s" && (%s)`,
			deploymentFilterValue(record.Id),
			deploymentFilterValue(serverID),
			activeDeploymentFilter(),
		)
		activeRecords, err := txApp.FindRecordsByFilter(col, filter, "", 1, 0)
		if err != nil {
			return err
		}
		if len(activeRecords) > 0 {
			return fmt.Errorf("server %s already has an active deployment", serverID)
		}

		if err := deploy.ApplyEventToRecord(txApp, record, deploy.EventValidationStarted, deploy.TransitionOptions{}); err != nil {
			return err
		}
		claimed = record
		return nil
	})
	if err != nil {
		return nil, err
	}
	return claimed, nil
}

func deploymentFilterValue(value string) string {
	return strings.ReplaceAll(value, `"`, `\\"`)
}

func deploymentHasReleaseSnapshot(record *core.Record) bool {
	value := record.Get("release_snapshot")
	if value == nil {
		return false
	}

	data, err := json.Marshal(value)
	if err != nil {
		return true
	}

	normalized := strings.TrimSpace(string(data))
	return normalized != "" && normalized != "null" && normalized != "{}" && normalized != "[]"
}

func appendDeploymentLog(app core.App, record *core.Record, line string) {
	if strings.TrimSpace(line) == "" {
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
		log.Printf("appendDeploymentLog: save deployment %s: %v", record.Id, err)
	}
}

func (w *Worker) handleRestartApp(_ context.Context, t *asynq.Task) error {
	var p RestartAppPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		log.Printf("handleRestartApp: unmarshal payload: %v", err)
		return err
	}
	// TODO: implement restart logic (docker compose restart for p.ProjectDir)
	log.Printf("handleRestartApp: not yet implemented for %s", p.ProjectDir)
	return nil
}

func (w *Worker) handleStopApp(_ context.Context, t *asynq.Task) error {
	var p StopAppPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		log.Printf("handleStopApp: unmarshal payload: %v", err)
		return err
	}
	// TODO: implement stop logic (docker compose stop for p.ProjectDir)
	log.Printf("handleStopApp: not yet implemented for %s", p.ProjectDir)
	return nil
}

func (w *Worker) handleDeleteApp(_ context.Context, t *asynq.Task) error {
	var p DeleteAppPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		log.Printf("handleDeleteApp: unmarshal payload: %v", err)
		return err
	}
	// TODO: implement delete logic (docker compose down + volume cleanup for p.ProjectDir)
	log.Printf("handleDeleteApp: not yet implemented for %s", p.ProjectDir)
	return nil
}

func (w *Worker) handleBackupCreate(_ context.Context, t *asynq.Task) error {
	var p BackupCreatePayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		log.Printf("handleBackupCreate: unmarshal payload: %v", err)
		return err
	}
	// TODO: implement backup creation (tar + encrypt to p.Name)
	// Write audit.StatusSuccess/Failed here once the operation is implemented.
	log.Printf("handleBackupCreate: not yet implemented for %s", p.Name)
	return nil
}

func (w *Worker) handleBackupRestore(_ context.Context, t *asynq.Task) error {
	var p BackupRestorePayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		log.Printf("handleBackupRestore: unmarshal payload: %v", err)
		return err
	}
	// TODO: implement restore logic (decrypt + extract from p.Name)
	// Write audit.StatusSuccess/Failed here once the operation is implemented.
	log.Printf("handleBackupRestore: not yet implemented for %s", p.Name)
	return nil
}
