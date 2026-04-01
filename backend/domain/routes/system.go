package routes

import (
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// registerSystemRoutes registers system-level routes.
//
// Endpoints:
//
//	GET  /api/ext/system/metrics   — CPU, memory, disk usage
//	GET  /api/ext/system/terminal  — WebSocket terminal (PTY)
//	GET  /api/ext/system/files     — file browser listing
func registerSystemRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	sys := g.Group("/system")
	sys.Bind(apis.RequireSuperuserAuth())

	sys.GET("/metrics", handleSystemMetrics)
	sys.GET("/terminal", handleTerminal)
	sys.GET("/files", handleFileBrowser)
}

// handleSystemMetrics returns host CPU, memory, and disk usage metrics.
//
// @Summary Get system metrics
// @Description Returns current CPU, memory, and disk usage for the host. Superuser only.
// @Tags Runtime Operations
// @Security BearerAuth
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/system/metrics [get]
func handleSystemMetrics(e *core.RequestEvent) error {
	// TODO: collect and return CPU, memory, disk metrics
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

// handleTerminal upgrades the connection to a WebSocket PTY session on the local host.
//
// @Summary Local WebSocket terminal
// @Description Upgrades to a WebSocket PTY session on the local server. Superuser only.
// @Tags Runtime Operations
// @Security BearerAuth
// @Success 101 {string} string "WebSocket upgrade"
// @Failure 401 {object} map[string]any
// @Router /api/ext/system/terminal [get]
func handleTerminal(e *core.RequestEvent) error {
	// TODO: upgrade to WebSocket, create PTY session via creack/pty
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

// handleFileBrowser returns a paginated listing of files on the local host.
//
// @Summary Browse local files
// @Description Returns a directory listing for the local server filesystem. Superuser only.
// @Tags Runtime Operations
// @Security BearerAuth
// @Param path query string false "directory path to list"
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/system/files [get]
func handleFileBrowser(e *core.RequestEvent) error {
	// TODO: list files with pagination and filtering
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}
