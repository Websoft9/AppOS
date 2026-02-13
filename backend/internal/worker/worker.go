// Package worker manages the embedded Asynq task worker.
//
// The worker runs as a goroutine inside the PocketBase process,
// connecting to Redis for persistent async task processing.
package worker

import (
	"context"
	"log"
	"os"

	"github.com/hibiken/asynq"
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

// Worker manages the Asynq server and a shared client for enqueuing tasks.
type Worker struct {
	server *asynq.Server
	client *asynq.Client
	redisOpt asynq.RedisClientOpt
}

// New creates a Worker with Asynq server and shared client.
// Call Start() to begin processing and Shutdown() to stop.
func New() *Worker {
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
		server:   srv,
		client:   client,
		redisOpt: opt,
	}
}

// Start begins processing tasks in a background goroutine.
// This should be called only once during the application lifecycle.
func (w *Worker) Start() {
	mux := asynq.NewServeMux()
	mux.HandleFunc(TaskDeployApp, handleDeployApp)
	mux.HandleFunc(TaskRestartApp, handleRestartApp)
	mux.HandleFunc(TaskStopApp, handleStopApp)
	mux.HandleFunc(TaskDeleteApp, handleDeleteApp)
	mux.HandleFunc(TaskBackupCreate, handleBackupCreate)
	mux.HandleFunc(TaskBackupRestore, handleBackupRestore)

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

func handleDeployApp(ctx context.Context, t *asynq.Task) error {
	// TODO: parse payload, run docker compose up
	return nil
}

func handleRestartApp(ctx context.Context, t *asynq.Task) error {
	// TODO: docker compose restart
	return nil
}

func handleStopApp(ctx context.Context, t *asynq.Task) error {
	// TODO: docker compose stop
	return nil
}

func handleDeleteApp(ctx context.Context, t *asynq.Task) error {
	// TODO: docker compose down, cleanup volumes
	return nil
}

func handleBackupCreate(ctx context.Context, t *asynq.Task) error {
	// TODO: tar + encrypt backup
	return nil
}

func handleBackupRestore(ctx context.Context, t *asynq.Task) error {
	// TODO: decrypt + restore backup
	return nil
}
