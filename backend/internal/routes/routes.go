// Package routes registers all custom API routes for AppOS.
//
// Route groups:
//   - /api/appos/apps     — application lifecycle (deploy, restart, stop, etc.)
//   - /api/appos/proxy    — reverse proxy domain/SSL management
//   - /api/appos/system   — system metrics, terminal, file browser
//   - /api/appos/backup   — backup/restore operations
package routes

import (
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// Register mounts all custom route groups on the PocketBase router.
func Register(se *core.ServeEvent) {
	// All custom routes require authentication
	g := se.Router.Group("/api/appos")
	g.Bind(apis.RequireAuth())

	registerAppRoutes(g)
	registerProxyRoutes(g)
	registerSystemRoutes(g)
	registerBackupRoutes(g)
}
