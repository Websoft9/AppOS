package routes

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/websoft9/appos/backend/internal/audit"
	"github.com/websoft9/appos/backend/internal/crypto"
	"github.com/websoft9/appos/backend/internal/settings"
	"github.com/websoft9/appos/backend/internal/tunnel"
)

// tunnelSessions is the in-memory session registry shared between the SSH server
// and the API handlers (status queries, disconnect-on-rotation).
var tunnelSessions *tunnel.Registry

const tunnelTokenSecretPrefix = "tunnel-token-"

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
// TokenValidator — PocketBase implementation
// ─────────────────────────────────────────────────────────────────────────────

type pbTokenValidator struct{ app core.App }

// Validate iterates all tunnel_token secrets, decrypts each, and matches the
// raw token. On match it returns the linked server ID.
//
// Complexity is O(n) over tunnel tokens. Acceptable for MVP; can be optimised
// with a HMAC-keyed index later if needed.
func (v *pbTokenValidator) Validate(rawToken string) (serverID string, ok bool) {
	secrets, err := v.app.FindRecordsByFilter(
		"secrets",
		"type = 'tunnel_token' && value != ''",
		"", 0, 0,
	)
	if err != nil {
		return "", false
	}

	for _, secret := range secrets {
		dec, err := crypto.Decrypt(secret.GetString("value"))
		if err != nil || dec != rawToken {
			continue
		}

		// Preferred mapping: secret name "tunnel-token-{serverID}".
		if name := secret.GetString("name"); strings.HasPrefix(name, tunnelTokenSecretPrefix) {
			sid := strings.TrimPrefix(name, tunnelTokenSecretPrefix)
			if sid != "" {
				if _, err := v.app.FindRecordById("servers", sid); err == nil {
					return sid, true
				}
			}
		}

		// Legacy fallback: token secret linked via servers.credential relation.
		server, err := v.app.FindFirstRecordByFilter(
			"servers",
			"credential = {:cid} && connect_type = 'tunnel'",
			dbx.Params{"cid": secret.Id},
		)
		if err == nil {
			return server.Id, true
		}
	}
	return "", false
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
	server.Set("tunnel_status", "online")
	server.Set("tunnel_last_seen", time.Now().UTC())
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
		Detail:       map[string]any{"services": services},
	})
}

func (h *pbSessionHooks) OnDisconnect(serverID string) {
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
	server.Set("tunnel_status", "offline")
	_ = h.app.Save(server)

	audit.Write(h.app, audit.Entry{
		Action:       "tunnel.disconnect",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────────

// registerTunnelRoutes wires the tunnel SSH server and exposes the tunnel API.
// Called from routes.Register.
func registerTunnelRoutes(se *core.ServeEvent, g *router.RouterGroup[*core.RequestEvent]) {
	// 1. Read port range from settings (fallback: 40000–49999).
	portRange, _ := settings.GetGroup(se.App, "tunnel", "port_range", map[string]any{})
	start := settings.Int(portRange, "start", 40000)
	end := settings.Int(portRange, "end", 49999)

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
	hooks := &pbSessionHooks{app: se.App, pool: pool, sessions: tunnelSessions}

	srv := &tunnel.Server{
		DataDir:    se.App.DataDir(),
		ListenAddr: ":2222",
		Validator:  validator,
		Pool:       pool,
		Sessions:   tunnelSessions,
		Hooks:      hooks,
	}

	// 4. Start SSH server in background.
	go func() {
		if err := srv.ListenAndServe(context.Background()); err != nil {
			log.Printf("[tunnel] server stopped: %v", err)
		}
	}()

	// 5. Authenticated API routes.
	t := g.Group("/tunnel")
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

	// 6. Unauthenticated setup-script route.
	se.Router.GET("/tunnel/setup/{token}", func(e *core.RequestEvent) error {
		return handleTunnelSetupScript(e)
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ext/tunnel/servers/:id/token
// ─────────────────────────────────────────────────────────────────────────────

// handleTunnelToken returns the existing tunnel token for a server, creating one
// if none exists yet.  It is intentionally idempotent: calling it repeatedly does
// NOT rotate the token and does NOT disconnect an active tunnel session.
//
// To explicitly rotate the token (generate a new one and kick the active session)
// the caller must include ?rotate=true in the query string.
//
// On first call (no credential): creates a new secrets record (type = tunnel_token)
// and links it to the server via the credential field.
func handleTunnelToken(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	wantRotate := e.Request.URL.Query().Get("rotate") == "true"

	server, err := e.App.FindRecordById("servers", id)
	if err != nil {
		return e.NotFoundError("server not found", err)
	}
	if server.GetString("connect_type") != "tunnel" {
		return e.BadRequestError("server is not a tunnel server", nil)
	}

	secret, err := findTunnelTokenSecret(e.App, id)
	if err != nil {
		return e.InternalServerError("failed to load token secret", err)
	}

	// Idempotent path: token already exists and caller did not request rotation.
	if secret != nil && !wantRotate {
		rawToken, err := crypto.Decrypt(secret.GetString("value"))
		if err != nil {
			return e.InternalServerError("token decryption failed", err)
		}
		return e.JSON(http.StatusOK, map[string]any{"token": rawToken})
	}

	// Generate a fresh token (first-time or explicit rotation).
	rawToken := tunnel.Generate()
	encToken, err := crypto.Encrypt(rawToken)
	if err != nil {
		return e.InternalServerError("token encryption failed", err)
	}

	rotating := secret != nil

	if secret != nil {
		secret.Set("name", tunnelTokenSecretName(id))
		secret.Set("type", "tunnel_token")
		secret.Set("value", encToken)
		if err := e.App.Save(secret); err != nil {
			return e.InternalServerError("failed to save rotated token", err)
		}

		if wantRotate && tunnelSessions != nil {
			tunnelSessions.Disconnect(id)
		}
	} else {
		// First time: create dedicated tunnel token secret (do not reuse SSH credential).
		secretCol, err := e.App.FindCollectionByNameOrId("secrets")
		if err != nil {
			return e.InternalServerError("secrets collection not found", err)
		}
		secret := core.NewRecord(secretCol)
		secret.Set("name", tunnelTokenSecretName(id))
		secret.Set("type", "tunnel_token")
		secret.Set("value", encToken)
		if err := e.App.Save(secret); err != nil {
			return e.InternalServerError("failed to save token", err)
		}
	}

	userID, _, ip, _ := clientInfo(e)
	action := "tunnel.token_generated"
	if rotating {
		action = "tunnel.token_rotated"
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       action,
		ResourceType: "server",
		ResourceID:   id,
		Status:       audit.StatusSuccess,
		IP:           ip,
	})

	return e.JSON(http.StatusOK, map[string]any{"token": rawToken})
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ext/tunnel/servers/:id/setup
// ─────────────────────────────────────────────────────────────────────────────

// handleTunnelSetup returns the autossh command, systemd unit text, and setup
// script URL needed to connect the local server.
func handleTunnelSetup(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")

	_, err := e.App.FindRecordById("servers", id)
	if err != nil {
		return e.NotFoundError("server not found", err)
	}

	secret, err := findTunnelTokenSecret(e.App, id)
	if err != nil {
		return e.InternalServerError("failed to load token secret", err)
	}
	if secret == nil {
		return e.BadRequestError("no token generated yet — call POST /token first", nil)
	}
	rawToken, err := crypto.Decrypt(secret.GetString("value"))
	if err != nil {
		return e.InternalServerError("token decryption failed", err)
	}

	apposHost := resolveApposHost(e)
	sshPort := tunnelSSHPort()

	autosshCmd := fmt.Sprintf(
		"autossh -M 0 -N \\\n  -R 0:localhost:22 \\\n  -R 0:localhost:80 \\\n  -p %s %s@%s \\\n  -o ServerAliveInterval=30 \\\n  -o ServerAliveCountMax=3 \\\n  -o StrictHostKeyChecking=no \\\n  -o UserKnownHostsFile=/dev/null \\\n  -o ExitOnForwardFailure=yes",
		sshPort, rawToken, apposHost,
	)

	systemdUnit := fmt.Sprintf(`[Unit]
Description=appos reverse SSH tunnel
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
Environment=AUTOSSH_GATETIME=0
ExecStart=/usr/bin/autossh -M 0 -N \
  -R 0:localhost:22 \
  -R 0:localhost:80 \
  -p %s %s@%s \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o ExitOnForwardFailure=yes
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target`, sshPort, rawToken, apposHost)

	setupScriptURL := fmt.Sprintf("/tunnel/setup/%s", rawToken)

	return e.JSON(http.StatusOK, map[string]any{
		"token":            rawToken,
		"autossh_cmd":      autosshCmd,
		"systemd_unit":     systemdUnit,
		"setup_script_url": setupScriptURL,
	})
}

// resolveApposHost returns the public host name of the appos instance.
// It is derived from the HTTP request (browsers always call the real host),
// stripping the port for the SSH :2222 connection.
func resolveApposHost(e *core.RequestEvent) string {
	host := e.Request.Host
	if host == "" {
		host = e.Request.Header.Get("X-Forwarded-Host")
	}
	// Strip port if present (e.g. "appos.example.com:8090" → "appos.example.com").
	if idx := strings.LastIndex(host, ":"); idx >= 0 {
		// Only strip if the part after ":" looks like a port (all digits), not IPv6.
		if !strings.Contains(host[:idx], "]") {
			host = host[:idx]
		}
	}
	if host == "" {
		host = "appos-host"
	}
	return host
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ext/tunnel/servers/:id/status
// ─────────────────────────────────────────────────────────────────────────────

// handleTunnelStatus returns live tunnel state from the in-memory registry.
// Falls back to the DB value when the server is offline.
func handleTunnelStatus(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")

	if tunnelSessions != nil {
		if sess, ok := tunnelSessions.Get(id); ok {
			return e.JSON(http.StatusOK, map[string]any{
				"status":       "online",
				"connected_at": sess.ConnectedAt.Format(time.RFC3339),
				"services":     sess.Services,
			})
		}
	}

	// Not in registry — read persisted state from DB.
	server, err := e.App.FindRecordById("servers", id)
	if err != nil {
		return e.NotFoundError("server not found", err)
	}

	var services any
	raw := server.GetString("tunnel_services")
	if raw != "" && raw != "null" {
		_ = json.Unmarshal([]byte(raw), &services)
	}

	return e.JSON(http.StatusOK, map[string]any{
		"status":    server.GetString("tunnel_status"),
		"last_seen": server.GetString("tunnel_last_seen"),
		"services":  services,
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /tunnel/setup/{token}  (unauthenticated)
// ─────────────────────────────────────────────────────────────────────────────

// handleTunnelSetupScript responds with a shell script that installs autossh
// and creates + enables a systemd service for the appos tunnel.
func handleTunnelSetupScript(e *core.RequestEvent) error {
	token := e.Request.PathValue("token")
	if token == "" {
		return e.BadRequestError("missing token", nil)
	}
	apposHost := resolveApposHost(e)
	sshPort := tunnelSSHPort()

	script := fmt.Sprintf(`#!/bin/bash
# appos tunnel setup script
# Auto-generated — do not edit

set -e

TOKEN="%s"
APPOS_HOST="%s"
SSH_PORT="%s"

# ── Determine tunnel binary (autossh preferred, ssh as fallback) ─────────────
USE_AUTOSSH=false
if command -v autossh &>/dev/null; then
  USE_AUTOSSH=true
else
  echo "autossh not found, attempting install..."
  if command -v apt-get &>/dev/null; then
    apt-get install -y autossh 2>/dev/null && USE_AUTOSSH=true
  elif command -v yum &>/dev/null; then
    yum install -y autossh 2>/dev/null && USE_AUTOSSH=true
  elif command -v dnf &>/dev/null; then
    dnf install -y autossh 2>/dev/null && USE_AUTOSSH=true
  elif command -v zypper &>/dev/null; then
    zypper install -y autossh 2>/dev/null && USE_AUTOSSH=true
  fi
  if [ "$USE_AUTOSSH" = false ]; then
    echo "WARNING: autossh could not be installed. Falling back to plain ssh." >&2
  fi
fi

# ── Build ExecStart depending on available binary ────────────────────────────
if [ "$USE_AUTOSSH" = true ]; then
	EXEC_START="/usr/bin/autossh -M 0 -N -R 0:localhost:22 -R 0:localhost:80 -p ${SSH_PORT} ${TOKEN}@${APPOS_HOST} -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ExitOnForwardFailure=yes"
else
	EXEC_START="/usr/bin/ssh -N -R 0:localhost:22 -R 0:localhost:80 -p ${SSH_PORT} ${TOKEN}@${APPOS_HOST} -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ExitOnForwardFailure=yes"
fi

# ── Write systemd unit ────────────────────────────────────────────────────────
cat >/etc/systemd/system/appos-tunnel.service <<EOF
[Unit]
Description=appos reverse SSH tunnel
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
Environment=AUTOSSH_GATETIME=0
ExecStart=${EXEC_START}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# ── Stop existing service if already running ─────────────────────────────────
systemctl stop appos-tunnel 2>/dev/null || true

# ── Enable and start ──────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable --now appos-tunnel

if [ "$USE_AUTOSSH" = true ]; then
  echo "✓ appos-tunnel service enabled and started (autossh)."
else
  echo "✓ appos-tunnel service enabled and started (ssh fallback)."
fi
echo "  Run: systemctl status appos-tunnel"
`, token, apposHost, sshPort)

	e.Response.Header().Set("Content-Type", "text/x-sh; charset=utf-8")
	e.Response.WriteHeader(http.StatusOK)
	_, _ = e.Response.Write([]byte(script))
	return nil
}
