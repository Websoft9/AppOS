// Package worker manages the embedded Asynq task worker.
//
// The worker runs as a goroutine inside the PocketBase process,
// connecting to Redis for persistent async task processing.
package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/core"
	lifecycleruntime "github.com/websoft9/appos/backend/domain/lifecycle/runtime"
	"github.com/websoft9/appos/backend/domain/runtimecfg"
)

const (
	// Task type constants
	TaskRestartApp    = "restart:app"
	TaskStopApp       = "stop:app"
	TaskDeleteApp     = "delete:app"
	TaskBackupCreate  = "backup:create"
	TaskBackupRestore = "backup:restore"
)

// ─── Payload Structs ─────────────────────────────────────
// Each payload struct must carry UserID + UserEmail so the worker can write
// audit records attributed to the originating user.

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

var deploymentExecutorFactory = lifecycleruntime.NewDeploymentExecutor

var deployServerLocks = struct {
	mu    sync.Mutex
	locks map[string]*sync.Mutex
}{
	locks: map[string]*sync.Mutex{},
}

// New creates a Worker with Asynq server and shared client.
// app is the PocketBase core.App used for audit writes inside task handlers.
// Call Start() to begin processing and Shutdown() to stop.
func New(app core.App) (*Worker, error) {
	redisConnOpt, err := asynq.ParseRedisURI(runtimecfg.RedisURL())
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}

	srv := asynq.NewServer(redisConnOpt, asynq.Config{
		Concurrency: 10,
		Queues: map[string]int{
			"critical": 6,
			"default":  3,
			"low":      1,
		},
	})

	client := asynq.NewClient(redisConnOpt)

	return &Worker{
		server: srv,
		client: client,
		app:    app,
	}, nil
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

	if err := w.recoverOrphanedOperations(); err != nil {
		log.Printf("recover orphaned operations: %v", err)
	}
	if err := w.recoverOrphanedSoftwareOperations(); err != nil {
		log.Printf("recover orphaned software operations: %v", err)
	}
	if err := w.recoverOrphanedDockerImagePullOperations(); err != nil {
		log.Printf("recover orphaned docker image pull operations: %v", err)
	}

	mux := w.newServeMux()
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

func (w *Worker) newServeMux() *asynq.ServeMux {
	mux := asynq.NewServeMux()
	mux.HandleFunc(TaskMonitorAppHealthSweep, w.handleMonitorAppHealthSweep)
	mux.HandleFunc(TaskMonitorAIProviderReachabilitySweep, w.handleMonitorAIProviderReachabilitySweep)
	mux.HandleFunc(TaskMonitorCredentialSweep, w.handleMonitorCredentialSweep)
	mux.HandleFunc(TaskMonitorFactsPull, w.handleMonitorFactsPull)
	mux.HandleFunc(TaskMonitorControlReachability, w.handleMonitorControlReachability)
	mux.HandleFunc(TaskMonitorMetricsFreshness, w.handleMonitorMetricsFreshness)
	mux.HandleFunc(TaskMonitorReachabilitySweep, w.handleMonitorReachabilitySweep)
	mux.HandleFunc(TaskMonitorConnectorReachabilitySweep, w.handleMonitorConnectorReachabilitySweep)
	mux.HandleFunc(TaskMonitorRuntimeSnapshotPull, w.handleMonitorRuntimeSnapshotPull)
	mux.HandleFunc(TaskRunOperation, w.handleRunOperation)
	mux.HandleFunc(TaskRestartApp, w.handleRestartApp)
	mux.HandleFunc(TaskStopApp, w.handleStopApp)
	mux.HandleFunc(TaskDeleteApp, w.handleDeleteApp)
	mux.HandleFunc(TaskBackupCreate, w.handleBackupCreate)
	mux.HandleFunc(TaskBackupRestore, w.handleBackupRestore)
	mux.HandleFunc(TaskSoftwareInstall, w.handleSoftwareAction)
	mux.HandleFunc(TaskSoftwareUpgrade, w.handleSoftwareAction)
	mux.HandleFunc(TaskSoftwareStart, w.handleSoftwareAction)
	mux.HandleFunc(TaskSoftwareStop, w.handleSoftwareAction)
	mux.HandleFunc(TaskSoftwareRestart, w.handleSoftwareAction)
	mux.HandleFunc(TaskSoftwareVerify, w.handleSoftwareAction)
	mux.HandleFunc(TaskSoftwareReinstall, w.handleSoftwareAction)
	mux.HandleFunc(TaskSoftwareUninstall, w.handleSoftwareAction)
	mux.HandleFunc(TaskSoftwareWarmSnapshot, w.handleSoftwareSnapshotWarm)
	mux.HandleFunc(TaskDockerImagePull, w.handleDockerImagePull)
	return mux
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
