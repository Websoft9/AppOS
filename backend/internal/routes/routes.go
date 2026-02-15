// Package routes registers all custom API routes for AppOS.
//
// Route groups:
//   - /api/ext/docker   — Docker operations (compose, images, containers, networks, volumes)
//   - /api/ext/proxy    — reverse proxy domain/SSL management
//   - /api/ext/system   — system metrics, terminal, file browser
//   - /api/ext/services — supervisord service management (Epic 6)
//   - /api/ext/backup   — backup/restore operations
package routes

import (
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// Register mounts all custom route groups on the PocketBase router.
func Register(se *core.ServeEvent) {
	// Setup routes (unauthenticated — only works when no superuser exists)
	registerSetupRoutes(se)

	// Auth helper routes (unauthenticated — email existence check, etc.)
	registerAuthRoutes(se)

	// All other custom routes require authentication
	g := se.Router.Group("/api/ext")
	g.Bind(apis.RequireAuth())

	registerDockerRoutes(g)
	registerProxyRoutes(g)
	registerSystemRoutes(g)
	registerServiceRoutes(g)
	registerBackupRoutes(g)
}
