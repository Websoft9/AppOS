package routes

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/websoft9/appos/backend/domain/audit"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	"github.com/websoft9/appos/backend/domain/terminal"
)

func registerServerOpsRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	serverOps := g.Group("/{serverId}/ops")
	serverOps.GET("/connectivity", handleServerConnectivity)
	serverOps.POST("/power", handleServerPower)
	serverOps.GET("/ports", handleServerPortsList)
	serverOps.GET("/ports/{port}", handleServerPortInspect)
	serverOps.POST("/ports/{port}/release", handleServerPortRelease)
	serverOps.GET("/systemd/services", handleSystemdServices)
	serverOps.GET("/systemd/{service}/status", handleSystemdServiceStatus)
	serverOps.GET("/systemd/{service}/content", handleSystemdServiceContent)
	serverOps.GET("/systemd/{service}/logs", handleSystemdServiceLogs)
	serverOps.POST("/systemd/{service}/action", handleSystemdServiceAction)
	serverOps.GET("/systemd/{service}/unit", handleSystemdServiceUnitRead)
	serverOps.PUT("/systemd/{service}/unit", handleSystemdServiceUnitWrite)
	serverOps.POST("/systemd/{service}/unit/verify", handleSystemdServiceUnitVerify)
	serverOps.POST("/systemd/{service}/unit/apply", handleSystemdServiceUnitApply)
	serverOps.POST("/monitor-agent/install", handleMonitorAgentInstall)
	serverOps.POST("/monitor-agent/update", handleMonitorAgentUpdate)
}

// ════════════════════════════════════════════════════════════
// Shared helpers & SSH infrastructure (Story 20.4)
// ════════════════════════════════════════════════════════════

var systemdServicePattern = regexp.MustCompile(`^[a-zA-Z0-9@._-]+(?:\.service)?$`)
var ssUsersProcessPattern = regexp.MustCompile(`\("([^"]+)",pid=([0-9]+),fd=[0-9]+\)`)
var dockerPublishedPortPattern = regexp.MustCompile(`:([0-9]+)->[^/]+/(tcp|udp)`)

func normalizeServiceName(name string) (string, error) {
	service := strings.TrimSpace(name)
	if service == "" {
		return "", fmt.Errorf("service required")
	}
	if !systemdServicePattern.MatchString(service) {
		return "", fmt.Errorf("invalid service name")
	}
	if !strings.HasSuffix(service, ".service") {
		service += ".service"
	}
	return service, nil
}

func normalizePortInspectParams(e *core.RequestEvent) (string, string, error) {
	protocol := strings.ToLower(strings.TrimSpace(e.Request.URL.Query().Get("protocol")))
	if protocol == "" {
		protocol = "tcp"
	}
	if protocol != "tcp" && protocol != "udp" {
		return "", "", fmt.Errorf("protocol must be tcp or udp")
	}

	view := strings.ToLower(strings.TrimSpace(e.Request.URL.Query().Get("view")))
	if view == "" {
		view = "all"
	}
	if view != "occupancy" && view != "reservation" && view != "all" {
		return "", "", fmt.Errorf("view must be occupancy, reservation, or all")
	}

	return protocol, view, nil
}

func normalizePortReleaseMode(raw string) (string, error) {
	mode := strings.ToLower(strings.TrimSpace(raw))
	if mode == "" {
		return "graceful", nil
	}
	if mode != "graceful" && mode != "force" {
		return "", fmt.Errorf("mode must be graceful or force")
	}
	return mode, nil
}

func normalizeConnectivityMode(raw string, defaultMode string) (string, error) {
	mode := strings.ToLower(strings.TrimSpace(raw))
	if mode == "" {
		mode = defaultMode
	}
	if mode == "" {
		mode = "tcp"
	}
	if mode != "tcp" && mode != "ssh" && mode != "tunnel" {
		return "", fmt.Errorf("mode must be tcp, ssh, or tunnel")
	}
	return mode, nil
}

// ════════════════════════════════════════════════════════════
// Connectivity & Power handlers
// ════════════════════════════════════════════════════════════

// handleServerConnectivity checks server connectivity mode (tcp/ssh/tunnel).
func handleServerConnectivity(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}

	server, err := e.App.FindRecordById("servers", serverID)
	if err != nil {
		return e.NotFoundError("server not found", err)
	}
	ms := servers.ManagedServerFromRecord(server)

	defaultMode := "tcp"
	if ms.ConnectType == servers.ConnectionModeTunnel {
		defaultMode = "tunnel"
	}

	mode, err := normalizeConnectivityMode(e.Request.URL.Query().Get("mode"), defaultMode)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	response := map[string]any{"status": "offline", "mode": mode}

	switch mode {
	case "tunnel":
		if tunnelSessions != nil {
			if _, ok := tunnelSessions.Get(serverID); ok {
				response["status"] = "online"
			}
		}
		return e.JSON(http.StatusOK, response)
	case "ssh":
		cfg, cfgErr := resolveTerminalConfig(e.App, e.Auth, serverID)
		if cfgErr != nil {
			response["reason"] = cfgErr.Error()
			return e.JSON(http.StatusOK, response)
		}
		ctx, cancel := context.WithTimeout(e.Request.Context(), 8*time.Second)
		defer cancel()

		start := time.Now()
		sess, connErr := (&terminal.SSHConnector{}).Connect(ctx, cfg)
		if connErr != nil {
			response["reason"] = connErr.Error()
			var ce *terminal.ConnectError
			if errors.As(connErr, &ce) {
				response["category"] = string(ce.Category)
				response["reason"] = ce.Message
			}
			return e.JSON(http.StatusOK, response)
		}
		_ = sess.Close()
		response["status"] = "online"
		response["latency_ms"] = time.Since(start).Milliseconds()
		return e.JSON(http.StatusOK, response)
	default:
		probe := directServerAccessProbe(ms.Host, ms.Port)
		if probe.Access.Status != "available" {
			response["reason"] = probe.Detail
			return e.JSON(http.StatusOK, response)
		}
		response["status"] = "online"
		response["latency_ms"] = probe.LatencyMS
		return e.JSON(http.StatusOK, response)
	}
}

func handleServerPower(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}

	var body struct {
		Action string `json:"action"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "invalid request body"})
	}

	action := strings.ToLower(strings.TrimSpace(body.Action))
	var command string
	switch action {
	case "restart":
		command = "(sudo -n systemctl reboot || sudo -n reboot || systemctl reboot || reboot)"
	case "shutdown":
		command = "(sudo -n systemctl poweroff || sudo -n shutdown -h now || systemctl poweroff || shutdown -h now)"
	default:
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "action must be restart or shutdown"})
	}

	cfg, err := resolveTerminalConfig(e.App, e.Auth, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	output, runErr := terminal.ExecuteSSHCommand(e.Request.Context(), cfg, command, 20*time.Second)
	expectedDisconnect := runErr != nil && isExpectedPowerDisconnect(runErr)
	userID, _, ip, _ := clientInfo(e)
	status := audit.StatusSuccess
	if runErr != nil && !expectedDisconnect {
		status = audit.StatusFailed
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "server.ops.power",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       status,
		IP:           ip,
		Detail:       map[string]any{"action": action, "output": output},
	})

	if runErr != nil && !expectedDisconnect {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error(), "output": output})
	}
	if expectedDisconnect {
		return e.JSON(http.StatusAccepted, map[string]any{"server_id": serverID, "action": action, "status": "accepted", "output": output})
	}

	return e.JSON(http.StatusOK, map[string]any{"server_id": serverID, "action": action, "status": "accepted", "output": output})
}

func isExpectedPowerDisconnect(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "connection reset") ||
		strings.Contains(message, "broken pipe") ||
		strings.Contains(message, "use of closed network connection") ||
		strings.Contains(message, "unexpected eof")
}
