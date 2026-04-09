package routes

import (
	"errors"
	"math"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/time/rate"

	"github.com/websoft9/appos/backend/domain/audit"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	serversvc "github.com/websoft9/appos/backend/domain/resource/servers/service"
)

// setupScriptLimiters is an IP-based rate limiter for the unauthenticated
// /tunnel/setup/{token} endpoint.  Limits each source IP to 1 req/s with
// a burst of 3 to prevent brute-force token enumeration (SEC-2).
//
// Entries are evicted after limiterEntryTTL of inactivity to prevent
// unbounded memory growth (P6).
var setupScriptLimiters sync.Map // remoteIP → *ipLimiterEntry

const limiterEntryTTL = int64(time.Hour)

type ipLimiterEntry struct {
	limiter  *rate.Limiter
	lastUsed atomic.Int64 // UnixNano
}

func setupScriptLimiter(ip string) *rate.Limiter {
	now := time.Now().UnixNano()
	if val, ok := setupScriptLimiters.Load(ip); ok {
		entry := val.(*ipLimiterEntry)
		entry.lastUsed.Store(now)
		return entry.limiter
	}
	entry := &ipLimiterEntry{limiter: rate.NewLimiter(rate.Limit(1), 3)}
	entry.lastUsed.Store(now)
	actual, _ := setupScriptLimiters.LoadOrStore(ip, entry)
	return actual.(*ipLimiterEntry).limiter
}

func init() {
	go func() {
		for {
			time.Sleep(30 * time.Minute)
			cutoff := time.Now().UnixNano() - limiterEntryTTL
			setupScriptLimiters.Range(func(key, value any) bool {
				if value.(*ipLimiterEntry).lastUsed.Load() < cutoff {
					setupScriptLimiters.Delete(key)
				}
				return true
			})
		}
	}()
}

func requireTunnelServer(e *core.RequestEvent, serverID string) (*core.Record, *servers.ManagedServer, error) {
	record, err := e.App.FindRecordById(serversvc.CollectionServers, serverID)
	if err != nil {
		return nil, nil, e.NotFoundError("server not found", err)
	}

	server := servers.ManagedServerFromRecord(record)
	if server == nil || !server.IsTunnel() {
		return nil, nil, e.BadRequestError("server is not a tunnel server", nil)
	}

	return record, server, nil
}

func tunnelServiceServerError(e *core.RequestEvent, err error) error {
	if errors.Is(err, serversvc.ErrTunnelServerNotFound) {
		return e.NotFoundError("server not found", err)
	}
	if errors.Is(err, serversvc.ErrServerNotTunnel) {
		return e.BadRequestError("server is not a tunnel server", nil)
	}
	return err
}

func tunnelForwardInputs(body []tunnelForwardBody) []serversvc.TunnelForwardInput {
	inputs := make([]serversvc.TunnelForwardInput, 0, len(body))
	for _, item := range body {
		inputs = append(inputs, serversvc.TunnelForwardInput{
			ServiceName: item.ServiceName,
			LocalPort:   item.LocalPort,
		})
	}
	return inputs
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

	result, err := tunnelService(e.App).GetOrIssueToken(id, wantRotate)
	if mapped := tunnelServiceServerError(e, err); mapped != err {
		return mapped
	}
	if err != nil {
		return e.InternalServerError("failed to issue tunnel token", err)
	}

	if !result.Changed {
		return e.JSON(http.StatusOK, map[string]any{"token": result.Token})
	}

	userID, _, ip, _ := clientInfo(e)
	action := serversvc.ActionTunnelTokenGenerated
	if result.Rotated {
		action = serversvc.ActionTunnelTokenRotated
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       action,
		ResourceType: "server",
		ResourceID:   id,
		Status:       audit.StatusSuccess,
		IP:           ip,
	})

	return e.JSON(http.StatusOK, map[string]any{"token": result.Token})
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

	setup, err := tunnelService(e.App).BuildSetupForServer(id, resolveApposHost(e), tunnelSSHPort())
	if errors.Is(err, serversvc.ErrTunnelTokenNotFound) {
		return e.BadRequestError("no token generated yet — call POST /token first", nil)
	}
	if mapped := tunnelServiceServerError(e, err); mapped != err {
		return mapped
	}
	if err != nil {
		return e.InternalServerError("failed to load tunnel setup", err)
	}

	return e.JSON(http.StatusOK, setup)
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tunnel/servers/:id/forwards
// ─────────────────────────────────────────────────────────────────────────────

// handleTunnelForwards returns desired forward mappings for a tunnel server.
func handleTunnelForwards(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	result, err := tunnelService(e.App).Forwards(id)
	if mapped := tunnelServiceServerError(e, err); mapped != err {
		return mapped
	}
	if err != nil {
		return e.InternalServerError("failed to load tunnel forwards", err)
	}

	return e.JSON(http.StatusOK, result)
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/tunnel/servers/:id/forwards
// ─────────────────────────────────────────────────────────────────────────────

// handleTunnelForwardsPut replaces desired forward mappings for a tunnel server.
func handleTunnelForwardsPut(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")

	var body tunnelForwardsRequest
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid forwards payload", err)
	}
	result, err := tunnelService(e.App).ReplaceForwards(id, tunnelForwardInputs(body.Forwards))
	if mapped := tunnelServiceServerError(e, err); mapped != err {
		return mapped
	}
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       serversvc.ActionTunnelForwardsUpdated,
		ResourceType: "server",
		ResourceID:   id,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail: map[string]any{
			"forwards": result.Forwards,
		},
	})

	return e.JSON(http.StatusOK, map[string]any{
		"forwards":           result.Forwards,
		"reconnect_required": true,
		"message":            "Tunnel mapping changes apply on next reconnect or regenerated setup.",
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tunnel/servers/:id/logs
// ─────────────────────────────────────────────────────────────────────────────

func handleTunnelLogs(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")

	logs, err := tunnelService(e.App).ConnectionLogs(id)
	if mapped := tunnelServiceServerError(e, err); mapped != err {
		return mapped
	}
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
	server, _, err := requireTunnelServer(e, id)
	if err != nil {
		return err
	}

	var body tunnelPauseRequest
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid pause payload", err)
	}
	if math.IsNaN(body.Minutes) || math.IsInf(body.Minutes, 0) || body.Minutes <= 0 {
		return e.BadRequestError("minutes must be a positive number", nil)
	}

	result, err := tunnelService(e.App).Pause(server, body.Minutes)
	if err != nil {
		return e.InternalServerError("failed to save tunnel pause", err)
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       serversvc.ActionTunnelPause,
		ResourceType: "server",
		ResourceID:   id,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail: map[string]any{
			"minutes":     body.Minutes,
			"pause_until": result.PauseUntilTime.Format(time.RFC3339),
		},
	})

	return e.JSON(http.StatusOK, result)
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tunnel/servers/:id/resume
// ─────────────────────────────────────────────────────────────────────────────

func handleTunnelResume(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	server, _, err := requireTunnelServer(e, id)
	if err != nil {
		return err
	}

	result, err := tunnelService(e.App).Resume(server)
	if err != nil {
		return e.InternalServerError("failed to resume tunnel", err)
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       serversvc.ActionTunnelResume,
		ResourceType: "server",
		ResourceID:   id,
		Status:       audit.StatusSuccess,
		IP:           ip,
	})

	return e.JSON(http.StatusOK, result)
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
	server, _, err := requireTunnelServer(e, id)
	if err != nil {
		return err
	}
	result, err := tunnelService(e.App).Status(server)
	if err != nil {
		return e.InternalServerError("failed to load tunnel status", err)
	}

	return e.JSON(http.StatusOK, result)
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
	overview, err := tunnelService(e.App).Overview()
	if err != nil {
		return e.InternalServerError("failed to load tunnel servers", err)
	}

	return e.JSON(http.StatusOK, overview)
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
	server, _, err := requireTunnelServer(e, id)
	if err != nil {
		return err
	}

	item, err := tunnelService(e.App).Session(server)
	if err != nil {
		return e.InternalServerError("failed to load tunnel session", err)
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

	result, err := tunnelService(e.App).Disconnect(id)
	if mapped := tunnelServiceServerError(e, err); mapped != err {
		return mapped
	}
	if err != nil {
		return e.InternalServerError("failed to disconnect tunnel", err)
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       serversvc.ActionTunnelDisconnect,
		ResourceType: "server",
		ResourceID:   id,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail: map[string]any{
			"reason":       result.Reason,
			"reason_label": result.ReasonLabel,
			"was_active":   result.WasActive,
		},
	})

	return e.JSON(http.StatusOK, result)
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
	script, err := tunnelService(e.App).BuildSetupScriptByToken(token, resolveApposHost(e), tunnelSSHPort())
	if errors.Is(err, serversvc.ErrTunnelTokenInvalid) {
		return e.BadRequestError("invalid tunnel token", nil)
	}
	if err != nil {
		return e.InternalServerError("failed to build tunnel setup script", err)
	}

	e.Response.Header().Set("Content-Type", "text/x-sh; charset=utf-8")
	e.Response.WriteHeader(http.StatusOK)
	_, _ = e.Response.Write([]byte(script))
	return nil
}
