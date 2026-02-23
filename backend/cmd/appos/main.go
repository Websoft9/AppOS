package main

import (
	"log"

	"github.com/websoft9/appos/backend/internal/hooks"
	"github.com/websoft9/appos/backend/internal/routes"
	"github.com/websoft9/appos/backend/internal/worker"

	// Register custom PocketBase migrations (Epic 8: Resource Store)
	_ "github.com/websoft9/appos/backend/internal/migrations"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

func main() {
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
		w.Start()
		return se.Next()
	})

	// Graceful shutdown: stop worker when PocketBase terminates
	app.OnTerminate().BindFunc(func(e *core.TerminateEvent) error {
		w.Shutdown()
		return e.Next()
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
