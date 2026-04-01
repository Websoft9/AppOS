package routes

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/time/rate"

	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/infra/crypto"
	"github.com/websoft9/appos/backend/domain/tunnel"
)

// setupScriptLimiters is an IP-based rate limiter for the unauthenticated
// /tunnel/setup/{token} endpoint.  Limits each source IP to 1 req/s with
// a burst of 3 to prevent brute-force token enumeration (SEC-2).
var setupScriptLimiters sync.Map // remoteIP → *rate.Limiter

func setupScriptLimiter(ip string) *rate.Limiter {
	val, _ := setupScriptLimiters.LoadOrStore(ip, rate.NewLimiter(rate.Limit(1), 3))
	return val.(*rate.Limiter)
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tunnel/servers/:id/token
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
//
// @Summary Get or rotate tunnel token
// @Description Returns the existing tunnel auth token for a server. Pass ?rotate=true to generate a new token and disconnect any active session. Superuser only.
// @Tags Tunnel
// @Security BearerAuth
// @Param id path string true "server record ID"
// @Param rotate query boolean false "set true to rotate the token"
// @Success 200 {object} map[string]any "token"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/tunnel/servers/{id}/token [post]
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
		// Invalidate old token in cache before overwriting.
		oldRaw, decErr := crypto.Decrypt(secret.GetString("value"))
		if decErr == nil && oldRaw != "" {
			tunnelTokenCache.Delete(oldRaw)
		}

		secret.Set("name", tunnelTokenSecretName(id))
		secret.Set("type", "tunnel_token")
		secret.Set("template_id", "single_value")
		secret.Set("created_source", "system")
		secret.Set("value", encToken)
		if err := e.App.Save(secret); err != nil {
			return e.InternalServerError("failed to save rotated token", err)
		}

		if wantRotate && tunnelSessions != nil {
			tunnelSessions.Disconnect(id, tunnel.DisconnectReasonTokenRotated)
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
		secret.Set("template_id", "single_value")
		secret.Set("created_source", "system")
		secret.Set("value", encToken)
		if err := e.App.Save(secret); err != nil {
			return e.InternalServerError("failed to save token", err)
		}
	}

	// Populate cache with new token.
	tunnelTokenCache.Store(rawToken, id)

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
// GET /api/tunnel/servers/:id/setup
// ─────────────────────────────────────────────────────────────────────────────

// handleTunnelSetup returns the autossh command, systemd unit text, and setup
// script URL needed to connect the local server.
// handleTunnelSetup returns the tunnel setup information for a server,
// including the autossh command, systemd unit file, and setup script URL.
//
// @Summary Get tunnel setup info
// @Description Returns autossh command, systemd unit, and setup script URL for configuring the reverse tunnel on a remote server. Superuser only.
// @Tags Tunnel
// @Security BearerAuth
// @Param id path string true "server record ID"
// @Success 200 {object} map[string]any "token, autossh_cmd, systemd_unit, setup_script_url"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/tunnel/servers/{id}/setup [get]
func handleTunnelSetup(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")

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
	if secret == nil {
		return e.BadRequestError("no token generated yet — call POST /token first", nil)
	}
	rawToken, err := crypto.Decrypt(secret.GetString("value"))
	if err != nil {
		return e.InternalServerError("token decryption failed", err)
	}

	apposHost := resolveApposHost(e)
	sshPort := tunnelSSHPort()
	forwards, err := loadTunnelForwardSpecs(server)
	if err != nil {
		return e.InternalServerError("failed to load tunnel forwards", err)
	}
	autosshCmd := buildTunnelAutosshCommand(forwards, sshPort, rawToken, apposHost)
	systemdUnit := buildTunnelSystemdUnit(forwards, sshPort, rawToken, apposHost)

	setupScriptURL := fmt.Sprintf("/tunnel/setup/%s", rawToken)

	return e.JSON(http.StatusOK, map[string]any{
		"token":            rawToken,
		"autossh_cmd":      autosshCmd,
		"systemd_unit":     systemdUnit,
		"setup_script_url": setupScriptURL,
		"forwards":         forwardSpecsToResponse(forwards),
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tunnel/servers/:id/forwards
// ─────────────────────────────────────────────────────────────────────────────

// handleTunnelForwards returns desired forward mappings for a tunnel server.
func handleTunnelForwards(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	server, err := e.App.FindRecordById("servers", id)
	if err != nil {
		return e.NotFoundError("server not found", err)
	}
	if server.GetString("connect_type") != "tunnel" {
		return e.BadRequestError("server is not a tunnel server", nil)
	}

	forwards, err := loadTunnelForwardSpecs(server)
	if err != nil {
		return e.InternalServerError("failed to load tunnel forwards", err)
	}

	return e.JSON(http.StatusOK, map[string]any{
		"forwards": forwardSpecsToResponse(forwards),
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/tunnel/servers/:id/forwards
// ─────────────────────────────────────────────────────────────────────────────

// handleTunnelForwardsPut replaces desired forward mappings for a tunnel server.
func handleTunnelForwardsPut(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	server, err := e.App.FindRecordById("servers", id)
	if err != nil {
		return e.NotFoundError("server not found", err)
	}
	if server.GetString("connect_type") != "tunnel" {
		return e.BadRequestError("server is not a tunnel server", nil)
	}

	var body tunnelForwardsRequest
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid forwards payload", err)
	}
	forwards, err := validateTunnelForwardBody(body.Forwards)
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}

	raw, err := json.Marshal(forwards)
	if err != nil {
		return e.InternalServerError("failed to serialize tunnel forwards", err)
	}
	server.Set("tunnel_forwards", string(raw))
	if err := e.App.Save(server); err != nil {
		return e.InternalServerError("failed to save tunnel forwards", err)
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "tunnel.forwards_updated",
		ResourceType: "server",
		ResourceID:   id,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail: map[string]any{
			"forwards": forwards,
		},
	})

	return e.JSON(http.StatusOK, map[string]any{
		"forwards":           forwardSpecsToResponse(forwards),
		"reconnect_required": true,
		"message":            "Tunnel mapping changes apply on next reconnect or regenerated setup.",
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tunnel/servers/:id/logs
// ─────────────────────────────────────────────────────────────────────────────

func handleTunnelLogs(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	server, err := e.App.FindRecordById("servers", id)
	if err != nil {
		return e.NotFoundError("server not found", err)
	}
	if server.GetString("connect_type") != "tunnel" {
		return e.BadRequestError("server is not a tunnel server", nil)
	}

	logs, err := loadTunnelConnectionLogs(e.App, id)
	if err != nil {
		return e.InternalServerError("failed to load tunnel connection logs", err)
	}

	return e.JSON(http.StatusOK, map[string]any{
		"items": logs,
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tunnel/servers/:id/pause
// ─────────────────────────────────────────────────────────────────────────────

func handleTunnelPause(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	server, err := e.App.FindRecordById("servers", id)
	if err != nil {
		return e.NotFoundError("server not found", err)
	}
	if server.GetString("connect_type") != "tunnel" {
		return e.BadRequestError("server is not a tunnel server", nil)
	}

	var body tunnelPauseRequest
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid pause payload", err)
	}
	if math.IsNaN(body.Minutes) || math.IsInf(body.Minutes, 0) || body.Minutes <= 0 {
		return e.BadRequestError("minutes must be a positive number", nil)
	}

	// Disconnect first to prevent the session from clearing pause_until
	// via OnConnect before the DB save completes.
	if tunnelSessions != nil {
		if _, ok := tunnelSessions.Get(id); ok {
			tunnelSessions.Disconnect(id, tunnel.DisconnectReasonPausedByOperator)
		}
	}

	now := time.Now().UTC()
	pauseUntil := now.Add(time.Duration(body.Minutes * float64(time.Minute)))
	server.Set("tunnel_pause_until", pauseUntil)
	if err := e.App.Save(server); err != nil {
		return e.InternalServerError("failed to save tunnel pause", err)
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "tunnel.pause",
		ResourceType: "server",
		ResourceID:   id,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail: map[string]any{
			"minutes":     body.Minutes,
			"pause_until": pauseUntil.Format(time.RFC3339),
		},
	})

	return e.JSON(http.StatusOK, map[string]any{
		"ok":          true,
		"status":      "paused",
		"pause_until": formatTunnelTime(pauseUntil),
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tunnel/servers/:id/resume
// ─────────────────────────────────────────────────────────────────────────────

func handleTunnelResume(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	server, err := e.App.FindRecordById("servers", id)
	if err != nil {
		return e.NotFoundError("server not found", err)
	}
	if server.GetString("connect_type") != "tunnel" {
		return e.BadRequestError("server is not a tunnel server", nil)
	}

	server.Set("tunnel_pause_until", nil)
	if err := e.App.Save(server); err != nil {
		return e.InternalServerError("failed to resume tunnel", err)
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "tunnel.resume",
		ResourceType: "server",
		ResourceID:   id,
		Status:       audit.StatusSuccess,
		IP:           ip,
	})

	return e.JSON(http.StatusOK, map[string]any{
		"ok":          true,
		"status":      "offline",
		"pause_until": "",
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tunnel/servers/:id/status
// ─────────────────────────────────────────────────────────────────────────────

// handleTunnelStatus returns live tunnel state from the in-memory registry.
// Falls back to the DB value when the server is offline.
//
// @Summary Get tunnel status
// @Description Returns live tunnel connection status for a server (online/offline, services, last seen). Superuser only.
// @Tags Tunnel
// @Security BearerAuth
// @Param id path string true "server record ID"
// @Success 200 {object} map[string]any "status, services, connected_at/last_seen"
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/tunnel/servers/{id}/status [get]
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
	status := server.GetString("tunnel_status")
	if tunnelPauseUntil(server).After(time.Now().UTC()) && status != "online" {
		status = "paused"
	}

	var services any
	raw := server.GetString("tunnel_services")
	if raw != "" && raw != "null" {
		_ = json.Unmarshal([]byte(raw), &services)
	}

	return e.JSON(http.StatusOK, map[string]any{
		"status":    status,
		"last_seen": server.GetString("tunnel_last_seen"),
		"services":  services,
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tunnel/overview
// ─────────────────────────────────────────────────────────────────────────────

// handleTunnelOverview returns a live operations snapshot for all tunnel servers.
//
// @Summary Get tunnel overview
// @Description Returns tunnel summary cards and the current tunnel server list for the operations view. Superuser only.
// @Tags Tunnel
// @Security BearerAuth
// @Success 200 {object} map[string]any "summary, items"
// @Failure 401 {object} map[string]any
// @Router /api/tunnel/overview [get]
func handleTunnelOverview(e *core.RequestEvent) error {
	servers, err := e.App.FindRecordsByFilter(
		"servers",
		"connect_type = 'tunnel'",
		"name", 0, 0,
	)
	if err != nil {
		return e.InternalServerError("failed to load tunnel servers", err)
	}

	serverIDs := make([]string, 0, len(servers))
	for _, rec := range servers {
		serverIDs = append(serverIDs, rec.Id)
	}
	groupNames, _ := loadTunnelGroupNames(e.App, serverIDs)

	summary := map[string]int{
		"total":                     len(servers),
		"online":                    0,
		"offline":                   0,
		"waiting_for_first_connect": 0,
	}
	items := make([]map[string]any, 0, len(servers))
	for _, rec := range servers {
		item := buildTunnelOverviewItem(rec, groupNames[rec.Id], tunnelSessions)
		reconnectInfo, err := loadRecentTunnelReconnectInfo(e.App, rec.Id)
		if err == nil {
			for key, value := range reconnectInfo {
				item[key] = value
			}
		}
		status, _ := item["status"].(string)
		if status == "online" {
			summary["online"]++
		} else {
			summary["offline"]++
			if isTunnelWaitingForFirstConnect(rec) {
				summary["waiting_for_first_connect"]++
			}
		}
		items = append(items, item)
	}

	return e.JSON(http.StatusOK, map[string]any{
		"summary": summary,
		"items":   items,
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tunnel/servers/:id/session
// ─────────────────────────────────────────────────────────────────────────────

// handleTunnelSession returns current or last-known session details for one tunnel server.
//
// @Summary Get tunnel session
// @Description Returns current or last-known tunnel session details for a server. Superuser only.
// @Tags Tunnel
// @Security BearerAuth
// @Param id path string true "server record ID"
// @Success 200 {object} map[string]any "session details"
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/tunnel/servers/{id}/session [get]
func handleTunnelSession(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	server, err := e.App.FindRecordById("servers", id)
	if err != nil {
		return e.NotFoundError("server not found", err)
	}
	if server.GetString("connect_type") != "tunnel" {
		return e.BadRequestError("server is not a tunnel server", nil)
	}

	groupNames, _ := loadTunnelGroupNames(e.App, []string{id})
	item := buildTunnelOverviewItem(server, groupNames[id], tunnelSessions)
	reconnectInfo, err := loadRecentTunnelReconnectInfo(e.App, id)
	if err == nil {
		for key, value := range reconnectInfo {
			item[key] = value
		}
	}
	return e.JSON(http.StatusOK, item)
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tunnel/servers/:id/disconnect
// ─────────────────────────────────────────────────────────────────────────────

// handleTunnelDisconnect actively closes the current tunnel session.
//
// @Summary Disconnect tunnel session
// @Description Closes the current tunnel session for a server. Superuser only.
// @Tags Tunnel
// @Security BearerAuth
// @Param id path string true "server record ID"
// @Success 200 {object} map[string]any "ok, status"
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/tunnel/servers/{id}/disconnect [post]
func handleTunnelDisconnect(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	server, err := e.App.FindRecordById("servers", id)
	if err != nil {
		return e.NotFoundError("server not found", err)
	}
	if server.GetString("connect_type") != "tunnel" {
		return e.BadRequestError("server is not a tunnel server", nil)
	}

	active := false
	if tunnelSessions != nil {
		if _, ok := tunnelSessions.Get(id); ok {
			active = true
			tunnelSessions.Disconnect(id, tunnel.DisconnectReasonOperatorDisconnect)
		}
	}

	status := "offline"
	if active {
		status = "disconnecting"
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "tunnel.disconnect",
		ResourceType: "server",
		ResourceID:   id,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail: map[string]any{
			"reason":       string(tunnel.DisconnectReasonOperatorDisconnect),
			"reason_label": "Disconnected by operator",
			"was_active":   active,
		},
	})

	return e.JSON(http.StatusOK, map[string]any{
		"ok":     true,
		"status": status,
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /tunnel/setup/{token}  (unauthenticated, rate-limited)
// ─────────────────────────────────────────────────────────────────────────────

// handleTunnelSetupScript responds with a shell script that installs autossh
// and creates + enables a systemd service for the appos tunnel.
//
// Rate-limited per source IP (SEC-2) to mitigate brute-force token enumeration.
//
// Security note (SEC-4): The curl|bash pattern is industry-standard for
// bootstrap scripts and is acceptable here because (a) the token itself is
// the authentication credential (256-bit entropy), and (b) the script is
// delivered over TLS in production.
//
// @Summary Download tunnel setup script
// @Description Returns a self-contained shell script to install autossh and configure the reverse tunnel systemd service on a remote server. Public (token is the auth credential).
// @Tags Tunnel
// @Param token path string true "tunnel auth token"
// @Success 200 {string} string "shell script"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 429 {object} map[string]any
// @Router /tunnel/setup/{token} [get]
func handleTunnelSetupScript(e *core.RequestEvent) error {
	// SEC-2: IP-based rate limiting for the unauthenticated endpoint.
	ip := e.RealIP()
	if !setupScriptLimiter(ip).Allow() {
		e.Response.Header().Set("Retry-After", "5")
		return e.JSON(http.StatusTooManyRequests, map[string]any{
			"message": "rate limit exceeded — try again later",
		})
	}

	token := e.Request.PathValue("token")
	if token == "" {
		return e.BadRequestError("missing token", nil)
	}
	serverID, ok := (&pbTokenValidator{app: e.App}).Validate(token)
	if !ok {
		return e.BadRequestError("invalid tunnel token", nil)
	}
	server, err := e.App.FindRecordById("servers", serverID)
	if err != nil {
		return e.BadRequestError("invalid tunnel token", err)
	}
	forwards, err := loadTunnelForwardSpecs(server)
	if err != nil {
		return e.InternalServerError("failed to load tunnel forwards", err)
	}
	apposHost := resolveApposHost(e)
	sshPort := tunnelSSHPort()
	execStartArgs := buildTunnelExecArgs(forwards, "${SSH_PORT}", "${TOKEN}", "${APPOS_HOST}")

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
	EXEC_START="/usr/bin/autossh %s"
else
	EXEC_START="/usr/bin/ssh %s"
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
`, token, apposHost, sshPort, execStartArgs, execStartArgs)

	e.Response.Header().Set("Content-Type", "text/x-sh; charset=utf-8")
	e.Response.WriteHeader(http.StatusOK)
	_, _ = e.Response.Write([]byte(script))
	return nil
}
