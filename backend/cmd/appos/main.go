package main

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/websoft9/appos/backend/cmd/appos/bootstrap"
	"github.com/websoft9/appos/backend/domain/certs"
	monitorplatform "github.com/websoft9/appos/backend/domain/monitor/signals/platform"
	"github.com/websoft9/appos/backend/domain/routes"
	"github.com/websoft9/appos/backend/domain/runtimecfg"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/domain/terminal"
	"github.com/websoft9/appos/backend/domain/worker"

	// Register custom PocketBase migrations (Epic 8: Resource Store)
	_ "github.com/websoft9/appos/backend/infra/migrations"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

func main() {
	cfg, resolvedArgs, err := runtimecfg.ResolveArgs(os.Args)
	if err != nil {
		log.Fatal(err)
	}
	runtimecfg.Set(cfg)
	os.Args = resolvedArgs
	secretDataDir := strings.TrimSpace(cfg.DataDir)
	if secretDataDir == "" {
		secretDataDir = strings.TrimSpace(os.Getenv("DATA_DIR"))
	}
	if secretDataDir == "" {
		secretDataDir = "/appos/data"
	}
	warning, generated, err := secrets.EnsureRuntimeKey(secretDataDir)
	if err != nil {
		log.Fatal(fmt.Errorf("secrets runtime key init failed: %w", err))
	}
	if warning != "" {
		log.Printf("[WARN] %s", warning)
	}
	if generated {
		log.Printf("generated and persisted APPOS_SECRET_KEY")
	}

	if err := secrets.LoadKeyFromEnv(); err != nil {
		log.Fatal(fmt.Errorf("secrets init failed: %w", err))
	}
	if err := secrets.LoadTemplatesFromDefaultPath(); err != nil {
		log.Fatal(fmt.Errorf("secrets templates init failed: %w", err))
	}
	if err := certs.LoadTemplatesFromDefaultPath(); err != nil {
		log.Fatal(fmt.Errorf("certificate templates init failed: %w", err))
	}

	app := pocketbase.New()
	runtimecfg.RegisterFlags(func(name string, value string, usage string) {
		app.RootCmd.PersistentFlags().String(name, value, usage)
	})

	serveMode := runtimecfg.IsServeCommand(os.Args[1:])
	var w *worker.Worker
	if serveMode {
		w, err = worker.New(app)
		if err != nil {
			log.Fatal(fmt.Errorf("worker init failed: %w", err))
		}
	}

	var platformObserver *monitorplatform.PlatformObserver
	if w != nil {
		platformObserver = monitorplatform.NewPlatformObserver(app, func() monitorplatform.RuntimeSnapshot {
			snap := w.Snapshot()
			return monitorplatform.RuntimeSnapshot{
				StartedAt:         snap.StartedAt,
				ServerRunning:     snap.ServerRunning,
				WorkerRunning:     snap.ServerRunning,
				SchedulerRunning:  snap.SchedulerRunning,
				SchedulerLastTick: snap.SchedulerLastTick,
				LastDispatchAt:    snap.LastDispatchAt,
				LastServerError:   snap.LastServerError,
				LastDispatchError: snap.LastDispatchError,
			}
		})
		routes.SetAsynqClient(w.Client())
		bootstrap.Register(app, w.Client())
	} else {
		// routes.asynqClient stays nil; route handlers and cron hooks
		// already guard against nil with early returns.
		bootstrap.Register(app, nil)
	}

	// Register custom routes
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		if err := ensureConfiguredSuperuser(se.App); err != nil {
			return err
		}
		routes.Register(se)
		return se.Next()
	})

	// Start Asynq worker when PocketBase starts serving
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		terminal.StartIdleMonitor()
		if w != nil {
			w.Start()
			platformObserver.Start()
		}
		return se.Next()
	})

	// Graceful shutdown: stop worker and session monitor when PocketBase terminates
	app.OnTerminate().BindFunc(func(e *core.TerminateEvent) error {
		terminal.StopIdleMonitor()
		if platformObserver != nil {
			platformObserver.Stop()
		}
		if w != nil {
			w.Shutdown()
		}
		return e.Next()
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}

func ensureConfiguredSuperuser(app core.App) error {
	cfg := runtimecfg.Get()
	if strings.ToLower(strings.TrimSpace(cfg.InitMode)) != runtimecfg.DefaultInitMode {
		return nil
	}
	if strings.TrimSpace(cfg.SuperuserEmail) == "" || cfg.SuperuserPassword == "" {
		log.Printf("superuser init skipped: missing superuser-email or superuser-password")
		return nil
	}

	collection, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		return fmt.Errorf("find superusers collection: %w", err)
	}

	record, err := app.FindAuthRecordByEmail(collection, cfg.SuperuserEmail)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("find configured superuser %s: %w", cfg.SuperuserEmail, err)
		}
		record = core.NewRecord(collection)
	}
	record.Set("email", cfg.SuperuserEmail)
	record.SetPassword(cfg.SuperuserPassword)
	if err := app.Save(record); err != nil {
		return fmt.Errorf("save configured superuser %s: %w", cfg.SuperuserEmail, err)
	}
	return nil
}
