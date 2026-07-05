package main

import (
	"fmt"
	"log"
	"os"

	"github.com/hibiken/asynq"
	"github.com/websoft9/appos/backend/cmd/appos/bootstrap"
	monitorplatform "github.com/websoft9/appos/backend/domain/monitor/signals/platform"
	"github.com/websoft9/appos/backend/domain/routes"
	"github.com/websoft9/appos/backend/domain/runtimecfg"
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

	var asynqClient *asynq.Client
	if w != nil {
		asynqClient = w.Client()
	}
	initState, err := bootstrap.Initialize(app, cfg, asynqClient)
	if err != nil {
		log.Fatal(err)
	}
	if initState.RuntimeKeyWarning != "" {
		log.Printf("[WARN] %s", initState.RuntimeKeyWarning)
	}
	if initState.RuntimeKeyGenerated {
		log.Printf("generated and persisted APPOS_SECRET_KEY")
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
	}

	// Register custom routes
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
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
