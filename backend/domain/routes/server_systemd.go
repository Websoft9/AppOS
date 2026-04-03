package routes

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/websoft9/appos/backend/domain/audit"
	servers "github.com/websoft9/appos/backend/domain/resource/server"
)

// ════════════════════════════════════════════════════════════
// Systemd service management handlers (Story 20.4)
// ════════════════════════════════════════════════════════════

func handleSystemdServices(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}

	cfg, err := servers.ResolveConfig(e.App, e.Auth, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	raw, runErr := executeSSHCommand(e.Request.Context(), cfg, "systemctl list-units --type=service --all --no-legend --no-pager", 20*time.Second)
	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error()})
	}

	keyword := strings.ToLower(strings.TrimSpace(e.Request.URL.Query().Get("keyword")))
	services := make([]map[string]string, 0)
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 5 {
			continue
		}
		name := parts[0]
		desc := strings.Join(parts[4:], " ")
		if keyword != "" && !strings.Contains(strings.ToLower(name), keyword) && !strings.Contains(strings.ToLower(desc), keyword) {
			continue
		}
		services = append(services, map[string]string{
			"name":         name,
			"load_state":   parts[1],
			"active_state": parts[2],
			"sub_state":    parts[3],
			"description":  desc,
		})
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.systemd.services",
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
	service, err := normalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, resolveErr := servers.ResolveConfig(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	showCmd := fmt.Sprintf("systemctl show %s --no-pager --property=Id,Description,LoadState,ActiveState,SubState,UnitFileState,MainPID,ExecMainStatus,ExecMainCode,StateChangeTimestamp", service)
	showRaw, runErr := executeSSHCommand(e.Request.Context(), cfg, showCmd, 20*time.Second)
	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error()})
	}

	statusCmd := fmt.Sprintf("systemctl status %s --no-pager --full --lines=40", service)
	statusRaw, _ := executeSSHCommand(e.Request.Context(), cfg, statusCmd, 20*time.Second)

	details := make(map[string]string)
	for _, line := range strings.Split(showRaw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		details[parts[0]] = parts[1]
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.systemd.status",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail:       map[string]any{"service": service},
	})

	return e.JSON(http.StatusOK, map[string]any{
		"server_id":   serverID,
		"service":     service,
		"status":      details,
		"status_text": statusRaw,
	})
}

func handleSystemdServiceLogs(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := normalizeServiceName(e.Request.PathValue("service"))
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

	cfg, resolveErr := servers.ResolveConfig(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	cmd := fmt.Sprintf("journalctl -u %s -n %d --no-pager --output=short-iso", service, lines)
	raw, runErr := executeSSHCommand(e.Request.Context(), cfg, cmd, 25*time.Second)
	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error()})
	}

	entries := make([]string, 0)
	for _, line := range strings.Split(raw, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		entries = append(entries, line)
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.systemd.logs",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail:       map[string]any{"service": service, "lines": lines},
	})

	return e.JSON(http.StatusOK, map[string]any{
		"server_id": serverID,
		"service":   service,
		"lines":     lines,
		"entries":   entries,
		"raw":       raw,
	})
}

func handleSystemdServiceContent(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := normalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, resolveErr := servers.ResolveConfig(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	cmd := fmt.Sprintf("systemctl cat %s --no-pager", service)
	raw, runErr := executeSSHCommand(e.Request.Context(), cfg, cmd, 20*time.Second)
	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error()})
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.systemd.content",
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
	service, err := normalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	var body struct {
		Action string `json:"action"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "invalid request body"})
	}

	action := strings.ToLower(strings.TrimSpace(body.Action))
	allowed := map[string]bool{
		"start":   true,
		"stop":    true,
		"restart": true,
		"enable":  true,
		"disable": true,
	}
	if !allowed[action] {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "action must be start, stop, restart, enable, or disable"})
	}

	cfg, resolveErr := servers.ResolveConfig(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	cmd := fmt.Sprintf("(sudo -n systemctl %s %s || systemctl %s %s)", action, service, action, service)
	output, runErr := executeSSHCommand(e.Request.Context(), cfg, cmd, 25*time.Second)

	userID, _, ip, _ := clientInfo(e)
	status := audit.StatusSuccess
	if runErr != nil {
		status = audit.StatusFailed
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.systemd.action",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       status,
		IP:           ip,
		Detail:       map[string]any{"service": service, "action": action, "output": output},
	})

	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error(), "output": output})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"server_id": serverID,
		"service":   service,
		"action":    action,
		"status":    "accepted",
		"output":    output,
	})
}

func handleSystemdServiceUnitRead(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := normalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, resolveErr := servers.ResolveConfig(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	unitPath, pathErr := resolveSystemdUnitPath(e.Request.Context(), cfg, service)
	if pathErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": pathErr.Error()})
	}

	raw, runErr := executeSSHCommand(e.Request.Context(), cfg, fmt.Sprintf("cat %s", shellQuote(unitPath)), 20*time.Second)
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
	service, err := normalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	var body struct {
		Content string `json:"content"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "invalid request body"})
	}
	if strings.TrimSpace(body.Content) == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "content required"})
	}
	const maxUnitContentBytes = 64 * 1024
	if len(body.Content) > maxUnitContentBytes {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "content too large (max 64KB)"})
	}

	cfg, resolveErr := servers.ResolveConfig(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	unitPath, pathErr := resolveSystemdUnitPath(e.Request.Context(), cfg, service)
	if pathErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": pathErr.Error()})
	}

	encoded := base64.StdEncoding.EncodeToString([]byte(body.Content))
	writeCmd := fmt.Sprintf("printf '%%s' '%s' | base64 -d | (sudo -n tee %s >/dev/null || tee %s >/dev/null)", encoded, shellQuote(unitPath), shellQuote(unitPath))
	writeOutput, writeErr := executeSSHCommand(e.Request.Context(), cfg, writeCmd, 25*time.Second)
	if writeErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": writeErr.Error(), "output": writeOutput})
	}

	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.systemd.unit.write",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		IP:           ip,
		Detail: map[string]any{
			"service": service,
			"path":    unitPath,
			"output":  writeOutput,
		},
	})

	return e.JSON(http.StatusOK, map[string]any{
		"server_id": serverID,
		"service":   service,
		"path":      unitPath,
		"status":    "saved",
		"output":    writeOutput,
	})
}

func handleSystemdServiceUnitVerify(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := normalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, resolveErr := servers.ResolveConfig(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	unitPath, pathErr := resolveSystemdUnitPath(e.Request.Context(), cfg, service)
	if pathErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": pathErr.Error()})
	}

	verifyCmd := fmt.Sprintf("(sudo -n systemd-analyze verify %s || systemd-analyze verify %s)", shellQuote(unitPath), shellQuote(unitPath))
	verifyOutput, verifyErr := executeSSHCommand(e.Request.Context(), cfg, verifyCmd, 25*time.Second)

	userID, _, ip, _ := clientInfo(e)
	status := audit.StatusSuccess
	if verifyErr != nil {
		status = audit.StatusFailed
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.systemd.unit.verify",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       status,
		IP:           ip,
		Detail: map[string]any{
			"service":       service,
			"path":          unitPath,
			"verify_output": verifyOutput,
		},
	})

	if verifyErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": verifyErr.Error(), "verify_output": verifyOutput})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"server_id":     serverID,
		"service":       service,
		"path":          unitPath,
		"status":        "valid",
		"verify_output": verifyOutput,
	})
}

func handleSystemdServiceUnitApply(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := normalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, resolveErr := servers.ResolveConfig(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	reloadCmd := "(sudo -n systemctl daemon-reload || systemctl daemon-reload)"
	reloadOutput, reloadErr := executeSSHCommand(e.Request.Context(), cfg, reloadCmd, 20*time.Second)
	if reloadErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": reloadErr.Error(), "reload_output": reloadOutput})
	}

	applyCmd := fmt.Sprintf("(sudo -n systemctl try-restart %s || systemctl try-restart %s)", service, service)
	applyOutput, applyErr := executeSSHCommand(e.Request.Context(), cfg, applyCmd, 25*time.Second)

	userID, _, ip, _ := clientInfo(e)
	status := audit.StatusSuccess
	if applyErr != nil {
		status = audit.StatusFailed
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.systemd.unit.apply",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       status,
		IP:           ip,
		Detail: map[string]any{
			"service":       service,
			"reload_output": reloadOutput,
			"apply_output":  applyOutput,
		},
	})

	if applyErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": applyErr.Error(), "apply_output": applyOutput, "reload_output": reloadOutput})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"server_id":     serverID,
		"service":       service,
		"status":        "applied",
		"reload_output": reloadOutput,
		"apply_output":  applyOutput,
	})
}

func resolveSystemdUnitPath(ctx context.Context, cfg servers.ConnectorConfig, service string) (string, error) {
	cmd := fmt.Sprintf("systemctl show %s --property=FragmentPath --value --no-pager", service)
	raw, err := executeSSHCommand(ctx, cfg, cmd, 20*time.Second)
	if err != nil {
		return "", err
	}
	unitPath := strings.TrimSpace(raw)
	if unitPath == "" || unitPath == "/dev/null" {
		return "", fmt.Errorf("systemd unit file not found")
	}
	return unitPath, nil
}
