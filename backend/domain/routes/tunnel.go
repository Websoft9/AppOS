package routes

import (
	"os"
	"sync"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/websoft9/appos/backend/domain/resource/tunnel"
)

// tunnelSessions holds the in-memory registry of active SSH tunnel connections.
// It is initialized once in registerTunnelRoutes() and shared between the SSH
// server (which registers/unregisters sessions) and the API handlers (which
// query/disconnect sessions).  Thread-safe via internal RWMutex.
//
// Design note: While package-level state is generally avoided, tunnelSessions
// is set exactly once during startup and is inherently shared singleton state
// (one SSH server per process).  Tests reinitialize it as needed.
var tunnelSessions *tunnel.Registry

// tunnelTokenCache maps raw token → serverID for O(1) lookup (SEC-3).
// Populated lazily on first Validate call and kept in sync by handleTunnelToken
// on create/rotate.  Thread-safe via sync.Map.
var tunnelTokenCache sync.Map

type tunnelForwardsRequest struct {
	Forwards []tunnelForwardBody `json:"forwards"`
}

type tunnelPauseRequest struct {
	Minutes float64 `json:"minutes"`
}

type tunnelForwardBody struct {
	ServiceName string `json:"service_name"`
	LocalPort   int    `json:"local_port"`
}

// tunnelSSHPort returns the publicly reachable SSH port for the tunnel.
// Defaults to "2222" (bare-metal). Set TUNNEL_SSH_PORT env var to override
// (e.g. "9222" when running behind Docker port mapping).
func tunnelSSHPort() string {
	if p := os.Getenv("TUNNEL_SSH_PORT"); p != "" {
		return p
	}
	return "2222"
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────────

// registerTunnelRoutes wires the tunnel SSH server and exposes the tunnel API.
// Called from routes.Register.
func registerTunnelRoutes(se *core.ServeEvent) {
	tunnelSessions = tunnel.NewRegistry()
	tunnel.StartWithPocketBase(se.App, tunnelSessions, &tunnelTokenCache, tunnelPauseUntil, tunnelDisconnectReasonLabel)

	// 2. Authenticated API routes.
	t := se.Router.Group("/api/tunnel")
	t.Bind(apis.RequireSuperuserAuth())

	t.POST("/servers/{id}/token", func(e *core.RequestEvent) error {
		return handleTunnelToken(e)
	})
	t.GET("/servers/{id}/setup", func(e *core.RequestEvent) error {
		return handleTunnelSetup(e)
	})
	t.GET("/servers/{id}/status", func(e *core.RequestEvent) error {
		return handleTunnelStatus(e)
	})
	t.GET("/servers/{id}/forwards", func(e *core.RequestEvent) error {
		return handleTunnelForwards(e)
	})
	t.PUT("/servers/{id}/forwards", func(e *core.RequestEvent) error {
		return handleTunnelForwardsPut(e)
	})
	t.GET("/servers/{id}/logs", func(e *core.RequestEvent) error {
		return handleTunnelLogs(e)
	})
	t.GET("/overview", func(e *core.RequestEvent) error {
		return handleTunnelOverview(e)
	})
	t.GET("/servers/{id}/session", func(e *core.RequestEvent) error {
		return handleTunnelSession(e)
	})
	t.POST("/servers/{id}/disconnect", func(e *core.RequestEvent) error {
		return handleTunnelDisconnect(e)
	})
	t.POST("/servers/{id}/pause", func(e *core.RequestEvent) error {
		return handleTunnelPause(e)
	})
	t.POST("/servers/{id}/resume", func(e *core.RequestEvent) error {
		return handleTunnelResume(e)
	})

	// 3. Unauthenticated setup-script route (rate-limited via handler).
	se.Router.GET("/tunnel/setup/{token}", func(e *core.RequestEvent) error {
		return handleTunnelSetupScript(e)
	})
}
