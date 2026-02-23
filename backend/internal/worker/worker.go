// Package worker manages the embedded Asynq task worker.
//
// The worker runs as a goroutine inside the PocketBase process,
// connecting to Redis for persistent async task processing.
package worker

import (
	"context"
	"encoding/json"
	"log"
	"os"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/core"
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
	UserID     string `json:"user_id"`
	UserEmail  string `json:"user_email"`
	ProjectDir string `json:"project_dir"`
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
	server *asynq.Server
	client *asynq.Client
	app    core.App // PocketBase app for audit writes
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
	mux := asynq.NewServeMux()
	mux.HandleFunc(TaskDeployApp, w.handleDeployApp)
	mux.HandleFunc(TaskRestartApp, w.handleRestartApp)
	mux.HandleFunc(TaskStopApp, w.handleStopApp)
	mux.HandleFunc(TaskDeleteApp, w.handleDeleteApp)
	mux.HandleFunc(TaskBackupCreate, w.handleBackupCreate)
	mux.HandleFunc(TaskBackupRestore, w.handleBackupRestore)

	go func() {
		if err := w.server.Run(mux); err != nil {
			log.Printf("asynq worker error: %v", err)
		}
	}()
}

// Client returns the shared Asynq client for enqueuing tasks.
func (w *Worker) Client() *asynq.Client {
	return w.client
}

// Shutdown gracefully stops the worker and closes the client connection.
func (w *Worker) Shutdown() {
	w.server.Shutdown()
	_ = w.client.Close()
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
	// TODO: implement deploy logic (docker compose up for p.ProjectDir)
	// Audit write belongs here once the operation is implemented.
	log.Printf("handleDeployApp: not yet implemented for %s", p.ProjectDir)
	return nil
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
