package main

import (
	"fmt"
	"log"

	"github.com/websoft9/appos/backend/domain/certs"
	"github.com/websoft9/appos/backend/platform/hooks"
	"github.com/websoft9/appos/backend/domain/routes"
	"github.com/websoft9/appos/backend/domain/secrets"
	servers "github.com/websoft9/appos/backend/domain/resource/control/servers"
	"github.com/websoft9/appos/backend/domain/worker"

	// Register custom PocketBase migrations (Epic 8: Resource Store)
	_ "github.com/websoft9/appos/backend/infra/migrations"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

func main() {
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

	// Initialize Asynq worker (created once, shared across app lifecycle)
	w := worker.New(app)
	routes.SetAsynqClient(w.Client())

	// Register custom routes
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		routes.Register(se)
		return se.Next()
	})

	// Register event hooks
	hooks.Register(app)

	// Start Asynq worker when PocketBase starts serving
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		servers.StartIdleMonitor()
		w.Start()
		return se.Next()
	})

	// Graceful shutdown: stop worker and session monitor when PocketBase terminates
	app.OnTerminate().BindFunc(func(e *core.TerminateEvent) error {
		servers.StopIdleMonitor()
		w.Shutdown()
		return e.Next()
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
