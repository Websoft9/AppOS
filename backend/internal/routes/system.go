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
//	GET  /api/appos/system/metrics   — CPU, memory, disk usage
//	GET  /api/appos/system/terminal  — WebSocket terminal (PTY)
//	GET  /api/appos/system/files     — file browser listing
func registerSystemRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	sys := g.Group("/system")
	sys.Bind(apis.RequireSuperuserAuth())

	sys.GET("/metrics", handleSystemMetrics)
	sys.GET("/terminal", handleTerminal)
	sys.GET("/files", handleFileBrowser)
}

func handleSystemMetrics(e *core.RequestEvent) error {
	// TODO: collect and return CPU, memory, disk metrics
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

func handleTerminal(e *core.RequestEvent) error {
	// TODO: upgrade to WebSocket, create PTY session via creack/pty
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

func handleFileBrowser(e *core.RequestEvent) error {
	// TODO: list files with pagination and filtering
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}
