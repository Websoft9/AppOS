package routes

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/websoft9/appos/backend/domain/audit"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	serversvc "github.com/websoft9/appos/backend/domain/resource/servers/service"
	"github.com/websoft9/appos/backend/domain/software"
	"github.com/websoft9/appos/backend/domain/terminal"
	"github.com/websoft9/appos/backend/domain/worker"
)

var enqueueSoftwareSnapshotWarmTask = worker.EnqueueSoftwareSnapshotWarm

var defaultWarmSnapshotComponents = []software.ComponentKey{
	software.ComponentKeyDocker,
	software.ComponentKeyReverseProxy,
	software.ComponentKeyTelegraf,
}

func registerServerOpsRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	serverOps := g.Group("/{serverId}/ops")
	serverOps.GET("/connectivity", handleServerConnectivity)
	serverOps.POST("/power", handleServerPower)
	serverOps.GET("/cron/jobs", handleServerCronJobsList)
	serverOps.POST("/cron/jobs", handleServerCronJobCreate)
	serverOps.PUT("/cron/jobs/{entryId}", handleServerCronJobUpdate)
	serverOps.POST("/cron/jobs/{entryId}/test", handleServerCronJobTest)
	serverOps.POST("/cron/jobs/{entryId}/enable", handleServerCronJobEnable)
	serverOps.POST("/cron/jobs/{entryId}/disable", handleServerCronJobDisable)
	serverOps.DELETE("/cron/jobs/{entryId}", handleServerCronJobDelete)
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
}

var ssUsersProcessPattern = regexp.MustCompile(`\("([^"]+)",pid=([0-9]+),fd=[0-9]+\)`)
var dockerPublishedPortPattern = regexp.MustCompile(`:([0-9]+)->[^/]+/(tcp|udp)`)

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

func normalizePortListParams(e *core.RequestEvent) (string, string, error) {
	protocol := strings.ToLower(strings.TrimSpace(e.Request.URL.Query().Get("protocol")))
	if protocol == "" {
		protocol = "tcp"
	}
	if protocol != "tcp" && protocol != "udp" && protocol != "all" {
		return "", "", fmt.Errorf("protocol must be tcp, udp, or all")
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

	userID, _, _, _ := clientInfo(e)
	input := serversvc.ConnectivityCheckInput{
		ServerID: serverID,
		Mode:     mode,
		Host:     ms.Host,
		Port:     ms.Port,
	}
	if mode == "ssh" {
		cfg, cfgErr := resolveTerminalConfig(e.App, e.Auth, serverID)
		if cfgErr != nil {
			input.ConfigError = cfgErr
		} else {
			input.Config = &cfg
		}
	}

	result, probeErr := newConnectivityRuntimeService().Check(e.Request.Context(), input)
	if probeErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": probeErr.Error()})
	}

	if result.ShouldCache {
		writeServerAccessCache(e.App, server, result.CacheStatus, result.CacheReason)
	}
	if result.ShouldWarm {
		warmServerSoftwareSnapshots(serverID, userID)
	}

	response := map[string]any{"status": result.Status, "mode": result.Mode}
	if result.Reason != "" {
		response["reason"] = result.Reason
	}
	if result.Category != "" {
		response["category"] = result.Category
	}
	if result.LatencyMS > 0 {
		response["latency_ms"] = result.LatencyMS
	}

	return e.JSON(http.StatusOK, response)
}

func newConnectivityRuntimeService() serversvc.ConnectivityRuntimeService {
	return serversvc.ConnectivityRuntimeService{
		TunnelConnected: func(serverID string) bool {
			if tunnelSessions == nil {
				return false
			}
			_, ok := tunnelSessions.Get(serverID)
			return ok
		},
		ConnectSSH: func(ctx context.Context, cfg terminal.ConnectorConfig) (io.Closer, error) {
			return (&terminal.SSHConnector{}).Connect(ctx, cfg)
		},
		ProbeTCP: func(host string, port int) serversvc.ConnectivityTCPProbeResult {
			probe := directServerAccessProbe(host, port)
			return serversvc.ConnectivityTCPProbeResult{
				AccessStatus: probe.Access.Status,
				AccessReason: probe.Access.Reason,
				Detail:       probe.Detail,
				LatencyMS:    probe.LatencyMS,
			}
		},
	}
}

func warmServerSoftwareSnapshots(serverID, userID string) {
	if asynqClient == nil || strings.TrimSpace(serverID) == "" {
		return
	}
	if err := enqueueSoftwareSnapshotWarmTask(asynqClient, serverID, userID, defaultWarmSnapshotComponents); err != nil {
		return
	}
}

// writeServerAccessCache persists the result of a connectivity probe back to
// the servers record so the list endpoint can serve it instantly without a
// live TCP probe on every page load.
func writeServerAccessCache(app core.App, record *core.Record, status, reason string) {
	now := time.Now().UTC().Format("2006-01-02 15:04:05.000Z")
	record.Set("access_status", status)
	record.Set("access_reason", reason)
	record.Set("access_checked_at", now)
	_ = app.Save(record)
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

	action, actionErr := serversvc.NormalizePowerAction(body.Action)
	if actionErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": actionErr.Error()})
	}

	cfg, proxyEnv, err := resolveTerminalConfigWithProxyForRequest(e, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	result, runErr := serversvc.PowerRuntimeService{Run: directSSHCommandAdapter(cfg, proxyEnv)}.Execute(e.Request.Context(), action)
	userID, _, ip, _ := clientInfo(e)
	status := audit.StatusSuccess
	if runErr != nil {
		status = audit.StatusFailed
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "server.ops.power",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       status,
		IP:           ip,
		Detail:       map[string]any{"action": action, "output": result.Output},
	})

	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error(), "output": result.Output})
	}
	if result.ExpectedDisconnect {
		return e.JSON(http.StatusAccepted, map[string]any{"server_id": serverID, "action": action, "status": result.Status, "output": result.Output})
	}

	return e.JSON(http.StatusOK, map[string]any{"server_id": serverID, "action": action, "status": result.Status, "output": result.Output})
}
