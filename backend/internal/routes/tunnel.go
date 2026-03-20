package routes

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/websoft9/appos/backend/internal/audit"
	"github.com/websoft9/appos/backend/internal/crypto"
	"github.com/websoft9/appos/backend/internal/settings"
	"github.com/websoft9/appos/backend/internal/tunnel"
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

const tunnelTokenSecretPrefix = "tunnel-token-"

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

func tunnelTokenSecretName(serverID string) string {
	return tunnelTokenSecretPrefix + serverID
}

func findTunnelTokenSecret(app core.App, serverID string) (*core.Record, error) {
	secret, err := app.FindFirstRecordByFilter(
		"secrets",
		"type = 'tunnel_token' && name = {:name}",
		dbx.Params{"name": tunnelTokenSecretName(serverID)},
	)
	if err == nil {
		return secret, nil
	}

	// Legacy compatibility: early versions linked tunnel token in servers.credential.
	server, sErr := app.FindRecordById("servers", serverID)
	if sErr != nil {
		return nil, nil
	}
	credID := server.GetString("credential")
	if credID == "" {
		return nil, nil
	}
	legacy, lErr := app.FindRecordById("secrets", credID)
	if lErr != nil {
		return nil, nil
	}
	if legacy.GetString("type") != "tunnel_token" {
		return nil, nil
	}
	return legacy, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// TokenValidator — PocketBase implementation (with O(1) cache — SEC-3)
// ─────────────────────────────────────────────────────────────────────────────

type pbTokenValidator struct {
	app core.App
}

type pbForwardResolver struct{ app core.App }

// Validate checks whether rawToken is a valid tunnel token and returns the
// associated server ID.
//
// Hot path: O(1) cache lookup in tunnelTokenCache.
// Cold path: Falls through to a full DB scan, decrypting each tunnel_token
// secret.  The full scan also populates the cache for subsequent calls.
func (v *pbTokenValidator) Validate(rawToken string) (serverID string, ok bool) {
	// O(1) cache hit path (SEC-3).
	if sid, cached := tunnelTokenCache.Load(rawToken); cached {
		serverID := sid.(string)
		server, err := v.app.FindRecordById("servers", serverID)
		if err != nil {
			tunnelTokenCache.Delete(rawToken) // server deleted
			return "", false
		}
		if pauseUntil := tunnelPauseUntil(server); pauseUntil.After(time.Now().UTC()) {
			audit.Write(v.app, audit.Entry{
				UserID:       "system",
				Action:       "tunnel.connect_rejected",
				ResourceType: "server",
				ResourceID:   serverID,
				Status:       audit.StatusSuccess,
				Detail: map[string]any{
					"reason":       "paused",
					"reason_label": "Rejected while paused",
					"pause_until":  pauseUntil.Format(time.RFC3339),
				},
			})
			return "", false
		}
		return serverID, true
	}

	// Cache miss — full scan and populate.
	return v.validateAndPopulateCache(rawToken)
}

// validateAndPopulateCache performs the O(n) scan over all tunnel_token secrets,
// populating the cache for every token it successfully decrypts.
func (v *pbTokenValidator) validateAndPopulateCache(rawToken string) (string, bool) {
	now := time.Now().UTC()
	secrets, err := v.app.FindRecordsByFilter(
		"secrets",
		"type = 'tunnel_token' && value != ''",
		"", 0, 0,
	)
	if err != nil {
		return "", false
	}

	var matchedServerID string
	matched := false

	for _, secret := range secrets {
		dec, err := crypto.Decrypt(secret.GetString("value"))
		if err != nil || dec == "" {
			continue
		}

		// Try to resolve the server ID from the secret name.
		sid := ""
		if name := secret.GetString("name"); strings.HasPrefix(name, tunnelTokenSecretPrefix) {
			sid = strings.TrimPrefix(name, tunnelTokenSecretPrefix)
		}
		if sid == "" {
			// Legacy fallback: token secret linked via servers.credential relation.
			server, err := v.app.FindFirstRecordByFilter(
				"servers",
				"credential = {:cid} && connect_type = 'tunnel'",
				dbx.Params{"cid": secret.Id},
			)
			if err != nil {
				continue
			}
			sid = server.Id
		}

		// Populate cache for every valid token (not just the one we're looking up).
		tunnelTokenCache.Store(dec, sid)

		if dec == rawToken {
			matchedServerID = sid
			matched = true
		}
	}

	if !matched {
		return "", false
	}

	// Check pause status for the matched server.
	server, err := v.app.FindRecordById("servers", matchedServerID)
	if err != nil {
		tunnelTokenCache.Delete(rawToken)
		return "", false
	}
	if pauseUntil := tunnelPauseUntil(server); pauseUntil.After(now) {
		audit.Write(v.app, audit.Entry{
			UserID:       "system",
			Action:       "tunnel.connect_rejected",
			ResourceType: "server",
			ResourceID:   matchedServerID,
			Status:       audit.StatusSuccess,
			Detail: map[string]any{
				"reason":       "paused",
				"reason_label": "Rejected while paused",
				"pause_until":  pauseUntil.Format(time.RFC3339),
			},
		})
		return "", false
	}
	return matchedServerID, true
}

func (v *pbForwardResolver) Resolve(serverID string) []tunnel.ForwardSpec {
	server, err := v.app.FindRecordById("servers", serverID)
	if err != nil {
		return tunnel.DefaultForwardSpecs()
	}
	forwards, err := loadTunnelForwardSpecs(server)
	if err != nil {
		return tunnel.DefaultForwardSpecs()
	}
	return forwards
}

// ─────────────────────────────────────────────────────────────────────────────
// SessionHooks — PocketBase implementation
// ─────────────────────────────────────────────────────────────────────────────

type pbSessionHooks struct {
	app      core.App
	pool     *tunnel.PortPool
	sessions *tunnel.Registry
}

func (h *pbSessionHooks) OnConnect(serverID string, services []tunnel.Service, conflicts []tunnel.ConflictResolution) {
	server, err := h.app.FindRecordById("servers", serverID)
	if err != nil {
		log.Printf("[tunnel] OnConnect: server %s not found: %v", serverID, err)
		return
	}

	svcJSON, _ := json.Marshal(services)
	now := time.Now().UTC()
	remoteAddr := ""
	connectedAt := now
	if h.sessions != nil {
		if sess, ok := h.sessions.Get(serverID); ok {
			connectedAt = sess.ConnectedAt.UTC()
			if sess.Conn != nil && sess.Conn.RemoteAddr() != nil {
				remoteAddr = sess.Conn.RemoteAddr().String()
			}
		}
	}
	server.Set("tunnel_status", "online")
	server.Set("tunnel_last_seen", now)
	server.Set("tunnel_connected_at", connectedAt)
	server.Set("tunnel_remote_addr", remoteAddr)
	server.Set("tunnel_disconnect_at", nil)
	server.Set("tunnel_disconnect_reason", "")
	server.Set("tunnel_pause_until", nil)
	server.Set("tunnel_services", string(svcJSON))
	if err := h.app.Save(server); err != nil {
		log.Printf("[tunnel] OnConnect: save server %s: %v", serverID, err)
	}

	// Record any port conflict resolutions so operators can audit them.
	for _, cr := range conflicts {
		audit.Write(h.app, audit.Entry{
			Action:       "tunnel.port_conflict_resolved",
			ResourceType: "server",
			ResourceID:   serverID,
			Status:       audit.StatusSuccess,
			Detail: map[string]any{
				"service":  cr.ServiceName,
				"old_port": cr.OldPort,
				"new_port": cr.NewPort,
			},
		})
	}

	audit.Write(h.app, audit.Entry{
		Action:       "tunnel.connect",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		Detail: map[string]any{
			"services":       services,
			"services_count": len(services),
			"remote_addr":    remoteAddr,
			"connected_at":   connectedAt.Format(time.RFC3339),
		},
	})
}

func (h *pbSessionHooks) OnDisconnect(serverID string, reason tunnel.DisconnectReason) {
	// If a replacement session already registered (kick-old scenario),
	// don't overwrite the status to offline.
	if h.sessions != nil {
		if _, active := h.sessions.Get(serverID); active {
			return
		}
	}

	server, err := h.app.FindRecordById("servers", serverID)
	if err != nil {
		return
	}
	disconnectAt := time.Now().UTC()
	server.Set("tunnel_status", "offline")
	server.Set("tunnel_disconnect_at", disconnectAt)
	server.Set("tunnel_disconnect_reason", string(reason))
	_ = h.app.Save(server)

	audit.Write(h.app, audit.Entry{
		Action:       "tunnel.disconnect",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		Detail: map[string]any{
			"reason":        string(reason),
			"reason_label":  tunnelDisconnectReasonLabel(string(reason)),
			"disconnect_at": disconnectAt.Format(time.RFC3339),
		},
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────────

// registerTunnelRoutes wires the tunnel SSH server and exposes the tunnel API.
// Called from routes.Register.
func registerTunnelRoutes(se *core.ServeEvent) {
	// 1. Read port range from settings.
	portRange, _ := settings.GetGroup(se.App, "tunnel", "port_range", map[string]any{})
	start := settings.Int(portRange, "start", tunnel.DefaultPortRangeStart)
	end := settings.Int(portRange, "end", tunnel.DefaultPortRangeEnd)

	// 2. Load existing tunnel_services → pre-reserve ports in pool.
	pool := tunnel.NewPortPool(start, end)
	tunnelSessions = tunnel.NewRegistry()

	existingServers, _ := se.App.FindRecordsByFilter(
		"servers",
		"connect_type = 'tunnel'",
		"", 0, 0,
	)
	var portRecords []tunnel.PortRecord
	for _, rec := range existingServers {
		raw := rec.GetString("tunnel_services")
		if raw == "" || raw == "null" {
			continue
		}
		var svcs []tunnel.Service
		if err := json.Unmarshal([]byte(raw), &svcs); err == nil && len(svcs) > 0 {
			portRecords = append(portRecords, tunnel.PortRecord{
				ServerID: rec.Id,
				Services: svcs,
			})
		}
	}
	pool.LoadExisting(portRecords)

	// 3. Build tunnel.Server with injected PocketBase dependencies.
	validator := &pbTokenValidator{app: se.App}
	forwardResolver := &pbForwardResolver{app: se.App}
	hooks := &pbSessionHooks{app: se.App, pool: pool, sessions: tunnelSessions}

	srv := &tunnel.Server{
		DataDir:         se.App.DataDir(),
		ListenAddr:      ":2222",
		Validator:       validator,
		Pool:            pool,
		ForwardResolver: forwardResolver,
		Sessions:        tunnelSessions,
		Hooks:           hooks,
	}

	// 4. Start SSH server in background.
	go func() {
		if err := srv.ListenAndServe(context.Background()); err != nil {
			log.Printf("[tunnel] server stopped: %v", err)
		}
	}()

	// 5. Authenticated API routes.
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

	// 6. Unauthenticated setup-script route (rate-limited via handler).
	se.Router.GET("/tunnel/setup/{token}", func(e *core.RequestEvent) error {
		return handleTunnelSetupScript(e)
	})
}
