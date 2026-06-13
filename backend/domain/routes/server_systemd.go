package routes

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/websoft9/appos/backend/domain/audit"
	serversvc "github.com/websoft9/appos/backend/domain/resource/servers/service"
	"github.com/websoft9/appos/backend/domain/terminal"
)

// ════════════════════════════════════════════════════════════
// Systemd service management handlers (Story 20.4)
// ════════════════════════════════════════════════════════════

func handleSystemdServices(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}

	cfg, proxyEnv, err := resolveTerminalConfigWithProxy(e.App, e.Auth, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}
	release, gateErr := acquireServerRealtimeSSHRead(e.Request.Context(), serverID)
	if gateErr != nil {
		return e.JSON(http.StatusServiceUnavailable, map[string]any{"message": gateErr.Error()})
	}
	defer release()
	run, cleanup, runnerErr := reusableRouteSSHCommandRunner(e.Request.Context(), cfg, proxyEnv)
	if runnerErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runnerErr.Error()})
	}
	defer cleanup()
	runtime := newSystemdRuntimeService(run)

	keyword := strings.ToLower(strings.TrimSpace(e.Request.URL.Query().Get("keyword")))
	serviceItems, runErr := runtime.ListServices(e.Request.Context(), keyword)
	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error()})
	}

	services := make([]map[string]string, 0, len(serviceItems))
	for _, item := range serviceItems {
		services = append(services, map[string]string{
			"name":         item.Name,
			"load_state":   item.LoadState,
			"active_state": item.ActiveState,
			"sub_state":    item.SubState,
			"description":  item.Description,
		})
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "server.ops.systemd.services",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail:       map[string]any{"count": len(services), "keyword": keyword},
	})

	return e.JSON(http.StatusOK, map[string]any{"server_id": serverID, "services": services})
}

func handleSystemdServiceStatus(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := serversvc.NormalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, proxyEnv, resolveErr := resolveTerminalConfigWithProxy(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}
	release, gateErr := acquireServerRealtimeSSHRead(e.Request.Context(), serverID)
	if gateErr != nil {
		return e.JSON(http.StatusServiceUnavailable, map[string]any{"message": gateErr.Error()})
	}
	defer release()
	run, cleanup, runnerErr := reusableRouteSSHCommandRunner(e.Request.Context(), cfg, proxyEnv)
	if runnerErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runnerErr.Error()})
	}
	defer cleanup()
	runtime := newSystemdRuntimeService(run)

	statusResult, runErr := runtime.Status(e.Request.Context(), service)
	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error()})
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "server.ops.systemd.status",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail:       map[string]any{"service": service},
	})

	return e.JSON(http.StatusOK, map[string]any{
		"server_id":   serverID,
		"service":     service,
		"status":      statusResult.Properties,
		"status_text": statusResult.StatusText,
	})
}

func handleSystemdServiceLogs(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := serversvc.NormalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	lines := 200
	if raw := strings.TrimSpace(e.Request.URL.Query().Get("lines")); raw != "" {
		if v, convErr := strconv.Atoi(raw); convErr == nil {
			if v < 20 {
				v = 20
			}
			if v > 1000 {
				v = 1000
			}
			lines = v
		}
	}

	cfg, proxyEnv, resolveErr := resolveTerminalConfigWithProxy(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}
	release, gateErr := acquireServerRealtimeSSHRead(e.Request.Context(), serverID)
	if gateErr != nil {
		return e.JSON(http.StatusServiceUnavailable, map[string]any{"message": gateErr.Error()})
	}
	defer release()
	run, cleanup, runnerErr := reusableRouteSSHCommandRunner(e.Request.Context(), cfg, proxyEnv)
	if runnerErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runnerErr.Error()})
	}
	defer cleanup()
	runtime := newSystemdRuntimeService(run)

	logsResult, runErr := runtime.Logs(e.Request.Context(), service, lines)
	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error()})
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "server.ops.systemd.logs",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail:       map[string]any{"service": service, "lines": lines},
	})

	return e.JSON(http.StatusOK, map[string]any{
		"server_id": serverID,
		"service":   service,
		"lines":     logsResult.Lines,
		"entries":   logsResult.Entries,
		"raw":       logsResult.Raw,
	})
}

func handleSystemdServiceContent(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := serversvc.NormalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, proxyEnv, resolveErr := resolveTerminalConfigWithProxy(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}
	release, gateErr := acquireServerRealtimeSSHRead(e.Request.Context(), serverID)
	if gateErr != nil {
		return e.JSON(http.StatusServiceUnavailable, map[string]any{"message": gateErr.Error()})
	}
	defer release()
	run, cleanup, runnerErr := reusableRouteSSHCommandRunner(e.Request.Context(), cfg, proxyEnv)
	if runnerErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runnerErr.Error()})
	}
	defer cleanup()
	runtime := newSystemdRuntimeService(run)

	raw, runErr := runtime.Content(e.Request.Context(), service)
	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error()})
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "server.ops.systemd.content",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail:       map[string]any{"service": service},
	})

	return e.JSON(http.StatusOK, map[string]any{
		"server_id": serverID,
		"service":   service,
		"content":   raw,
	})
}

func handleSystemdServiceAction(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := serversvc.NormalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	var body struct {
		Action string `json:"action"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "invalid request body"})
	}

	action, err := serversvc.ValidateSystemdAction(body.Action)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, proxyEnv, resolveErr := resolveTerminalConfigWithProxy(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	result, runErr := newDirectSystemdRuntimeService(cfg, proxyEnv).Action(e.Request.Context(), service, action)

	userID, _, ip, _ := clientInfo(e)
	status := audit.StatusSuccess
	if runErr != nil {
		status = audit.StatusFailed
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "server.ops.systemd.action",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       status,
		IP:           ip,
		Detail:       map[string]any{"service": service, "action": action, "output": result.Output},
	})

	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error(), "output": result.Output})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"server_id": serverID,
		"service":   service,
		"action":    result.Action,
		"status":    result.Status,
		"output":    result.Output,
	})
}

func handleSystemdServiceUnitRead(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := serversvc.NormalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, proxyEnv, resolveErr := resolveTerminalConfigWithProxy(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}
	release, gateErr := acquireServerRealtimeSSHRead(e.Request.Context(), serverID)
	if gateErr != nil {
		return e.JSON(http.StatusServiceUnavailable, map[string]any{"message": gateErr.Error()})
	}
	defer release()
	run, cleanup, runnerErr := reusableRouteSSHCommandRunner(e.Request.Context(), cfg, proxyEnv)
	if runnerErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runnerErr.Error()})
	}
	defer cleanup()

	unitPath, pathErr := resolveSystemdUnitPathWithRunner(e.Request.Context(), run, service)
	if pathErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": pathErr.Error()})
	}

	raw, runErr := run(e.Request.Context(), fmt.Sprintf("cat %s", terminal.ShellQuote(unitPath)), 20*time.Second)
	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error()})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"server_id": serverID,
		"service":   service,
		"path":      unitPath,
		"content":   raw,
	})
}

func handleSystemdServiceUnitWrite(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := serversvc.NormalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	var body struct {
		Content string `json:"content"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "invalid request body"})
	}
	if err := serversvc.ValidateSystemdUnitContent(body.Content); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, proxyEnv, resolveErr := resolveTerminalConfigWithProxy(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	result, writeErr := newDirectSystemdRuntimeService(cfg, proxyEnv).WriteUnit(e.Request.Context(), service, body.Content)
	if writeErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": writeErr.Error(), "output": result.Output})
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "server.ops.systemd.unit.write",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail: map[string]any{
			"service": service,
			"path":    result.Path,
			"output":  result.Output,
		},
	})

	return e.JSON(http.StatusOK, map[string]any{
		"server_id": serverID,
		"service":   service,
		"path":      result.Path,
		"status":    result.Status,
		"output":    result.Output,
	})
}

func handleSystemdServiceUnitVerify(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := serversvc.NormalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, proxyEnv, resolveErr := resolveTerminalConfigWithProxy(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	result, verifyErr := newDirectSystemdRuntimeService(cfg, proxyEnv).VerifyUnit(e.Request.Context(), service)

	userID, _, ip, _ := clientInfo(e)
	status := audit.StatusSuccess
	if verifyErr != nil {
		status = audit.StatusFailed
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "server.ops.systemd.unit.verify",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       status,
		IP:           ip,
		Detail: map[string]any{
			"service":       service,
			"path":          result.Path,
			"verify_output": result.VerifyOutput,
		},
	})

	if verifyErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": verifyErr.Error(), "verify_output": result.VerifyOutput})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"server_id":     serverID,
		"service":       service,
		"path":          result.Path,
		"status":        result.Status,
		"verify_output": result.VerifyOutput,
	})
}

func handleSystemdServiceUnitApply(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := serversvc.NormalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, proxyEnv, resolveErr := resolveTerminalConfigWithProxy(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	result, applyErr := newDirectSystemdRuntimeService(cfg, proxyEnv).ApplyUnit(e.Request.Context(), service)

	userID, _, ip, _ := clientInfo(e)
	status := audit.StatusSuccess
	if applyErr != nil {
		status = audit.StatusFailed
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "server.ops.systemd.unit.apply",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       status,
		IP:           ip,
		Detail: map[string]any{
			"service":       service,
			"reload_output": result.ReloadOutput,
			"apply_output":  result.ApplyOutput,
		},
	})

	if applyErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": applyErr.Error(), "apply_output": result.ApplyOutput, "reload_output": result.ReloadOutput})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"server_id":     serverID,
		"service":       service,
		"status":        result.Status,
		"reload_output": result.ReloadOutput,
		"apply_output":  result.ApplyOutput,
	})
}

func resolveSystemdUnitPathWithRunner(ctx context.Context, run routeSSHCommandRunner, service string) (string, error) {
	return newSystemdRuntimeService(run).ResolveUnitPath(ctx, service)
}

func newSystemdRuntimeService(run routeSSHCommandRunner) serversvc.SystemdRuntimeService {
	return serversvc.SystemdRuntimeService{
		Run: routeSSHCommandAdapter(run),
	}
}

func newDirectSystemdRuntimeService(cfg terminal.ConnectorConfig, env map[string]string) serversvc.SystemdRuntimeService {
	return serversvc.SystemdRuntimeService{
		Run: directSSHCommandAdapter(cfg, env),
	}
}
