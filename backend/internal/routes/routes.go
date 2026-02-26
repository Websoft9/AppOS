// Package routes registers all custom API routes for AppOS.
//
// Route groups:
//   - /api/ext/docker     — Docker operations (compose, images, containers, networks, volumes)
//   - /api/ext/proxy      — reverse proxy domain/SSL management
//   - /api/ext/system     — system metrics, terminal, file browser
//   - /api/ext/services   — supervisord service management (Epic 6)
//   - /api/ext/backup     — backup/restore operations
//   - /api/ext/resources  — Resource Store CRUD (Epic 8)
//   - /api/ext/space      — User private space (Epic 9)
//   - /api/ext/iac        — IaC file management (Epic 14, superuser-only)
package routes

import (
	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// asynqClient is set by main via SetAsynqClient after creating the worker.
// It is used by route handlers that need to enqueue background tasks.
var asynqClient *asynq.Client

// SetAsynqClient stores the Asynq client for use in async route handlers.
func SetAsynqClient(c *asynq.Client) {
	asynqClient = c
}

// Register mounts all custom route groups on the PocketBase router.
func Register(se *core.ServeEvent) {
	// Setup routes (unauthenticated — only works when no superuser exists)
	registerSetupRoutes(se)

	// Auth helper routes (unauthenticated — email existence check, etc.)
	registerAuthRoutes(se)

	// Public space share routes (unauthenticated — share token validation and download)
	registerSpacePublicRoutes(se)

	// Ext Settings API (superuser-only — registered directly on se.Router)
	RegisterSettings(se)

	// All other custom routes require authentication
	g := se.Router.Group("/api/ext")
	g.Bind(apis.RequireAuth())

	registerDockerRoutes(g)
	registerProxyRoutes(g)
	registerSystemRoutes(g)
	registerServiceRoutes(g)
	registerBackupRoutes(g)
	registerResourceRoutes(g)
	registerSpaceRoutes(g)
	registerUserRoutes(g)
	registerIaCRoutes(g)
	registerTerminalRoutes(g)
}
