package routes

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/domain/terminal"
)

var systemdAnsiPattern = regexp.MustCompile(`\x1b\[[0-9;]*m`)

// ════════════════════════════════════════════════════════════
// Systemd service management handlers (Story 20.4)
// ════════════════════════════════════════════════════════════

func handleSystemdServices(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}

	cfg, err := resolveTerminalConfig(e.App, e.Auth, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	raw, runErr := terminal.ExecuteSSHCommand(e.Request.Context(), cfg, "systemctl list-units --type=service --all --plain --no-legend --no-pager", 20*time.Second)
	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error()})
	}

	keyword := strings.ToLower(strings.TrimSpace(e.Request.URL.Query().Get("keyword")))
	services := parseSystemdServicesOutput(raw, keyword)

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

func parseSystemdServicesOutput(raw, keyword string) []map[string]string {
	services := make([]map[string]string, 0)
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(systemdAnsiPattern.ReplaceAllString(line, ""))
		if line == "" {
			continue
		}
		parts := normalizeSystemdListFields(strings.Fields(line))
		if len(parts) < 4 {
			continue
		}

		name := ""
		loadState := ""
		activeState := ""
		subState := ""
		desc := ""

		if isSystemdServiceUnit(parts[0]) && isSystemdLoadState(parts[1]) && isSystemdActiveState(parts[2]) && isSystemdSubState(parts[3]) {
			name = parts[0]
			loadState = parts[1]
			activeState = parts[2]
			subState = parts[3]
			if len(parts) > 4 {
				desc = strings.Join(parts[4:], " ")
			}
		} else if len(parts) == 4 && isSystemdLoadState(parts[0]) && isSystemdActiveState(parts[1]) && isSystemdSubState(parts[2]) && isSystemdServiceUnit(parts[3]) {
			loadState = parts[0]
			activeState = parts[1]
			subState = parts[2]
			name = parts[3]
		} else {
			continue
		}

		if keyword != "" && !strings.Contains(strings.ToLower(name), keyword) && !strings.Contains(strings.ToLower(desc), keyword) {
			continue
		}
		services = append(services, map[string]string{
			"name":         name,
			"load_state":   loadState,
			"active_state": activeState,
			"sub_state":    subState,
			"description":  desc,
		})
	}
	return services
}

func normalizeSystemdListFields(fields []string) []string {
	normalized := make([]string, 0, len(fields))
	for _, field := range fields {
		field = strings.TrimSpace(field)
		field = strings.TrimLeft(field, "●○*•")
		field = strings.TrimSpace(field)
		if field == "" {
			continue
		}
		normalized = append(normalized, field)
	}
	return normalized
}

func isSystemdLoadState(value string) bool {
	switch strings.ToLower(value) {
	case "loaded", "not-found", "bad-setting", "error", "masked", "merged", "stub":
		return true
	default:
		return false
	}
}

func isSystemdServiceUnit(value string) bool {
	return strings.HasSuffix(strings.ToLower(strings.TrimSpace(value)), ".service")
}

func isSystemdActiveState(value string) bool {
	switch strings.ToLower(value) {
	case "active", "reloading", "inactive", "failed", "activating", "deactivating", "maintenance":
		return true
	default:
		return false
	}
}

func isSystemdSubState(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "running", "dead", "exited", "failed", "start", "start-pre", "start-post", "stop", "stop-sigterm", "stop-sigkill", "stop-post", "auto-restart", "listening", "waiting", "elapsed", "plugged", "mounted", "remounting", "unmounting", "condition", "reload", "reload-signal", "reload-notify", "final-sigterm", "final-sigkill":
		return true
	default:
		return false
	}
}

func handleSystemdServiceStatus(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	service, err := normalizeServiceName(e.Request.PathValue("service"))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, resolveErr := resolveTerminalConfig(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	showCmd := fmt.Sprintf("systemctl show %s --no-pager --property=Id,Description,LoadState,ActiveState,SubState,UnitFileState,MainPID,ExecMainStatus,ExecMainCode,StateChangeTimestamp", service)
	showRaw, runErr := terminal.ExecuteSSHCommand(e.Request.Context(), cfg, showCmd, 20*time.Second)
	if runErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error()})
	}

	statusCmd := fmt.Sprintf("systemctl status %s --no-pager --full --lines=40", service)
	statusRaw, _ := terminal.ExecuteSSHCommand(e.Request.Context(), cfg, statusCmd, 20*time.Second)

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

	cfg, resolveErr := resolveTerminalConfig(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	cmd := fmt.Sprintf("journalctl -u %s -n %d --no-pager --output=short-iso", service, lines)
	raw, runErr := terminal.ExecuteSSHCommand(e.Request.Context(), cfg, cmd, 25*time.Second)
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

	cfg, resolveErr := resolveTerminalConfig(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	cmd := fmt.Sprintf("systemctl cat %s --no-pager", service)
	raw, runErr := terminal.ExecuteSSHCommand(e.Request.Context(), cfg, cmd, 20*time.Second)
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

	cfg, resolveErr := resolveTerminalConfig(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	cmd := fmt.Sprintf("(sudo -n systemctl %s %s || systemctl %s %s)", action, service, action, service)
	output, runErr := terminal.ExecuteSSHCommand(e.Request.Context(), cfg, cmd, 25*time.Second)

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

	cfg, resolveErr := resolveTerminalConfig(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	unitPath, pathErr := resolveSystemdUnitPath(e.Request.Context(), cfg, service)
	if pathErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": pathErr.Error()})
	}

	raw, runErr := terminal.ExecuteSSHCommand(e.Request.Context(), cfg, fmt.Sprintf("cat %s", terminal.ShellQuote(unitPath)), 20*time.Second)
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

	cfg, resolveErr := resolveTerminalConfig(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	unitPath, pathErr := resolveSystemdUnitPath(e.Request.Context(), cfg, service)
	if pathErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": pathErr.Error()})
	}

	encoded := base64.StdEncoding.EncodeToString([]byte(body.Content))
	writeCmd := fmt.Sprintf("printf '%%s' '%s' | base64 -d | (sudo -n tee %s >/dev/null || tee %s >/dev/null)", encoded, terminal.ShellQuote(unitPath), terminal.ShellQuote(unitPath))
	writeOutput, writeErr := terminal.ExecuteSSHCommand(e.Request.Context(), cfg, writeCmd, 25*time.Second)
	if writeErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": writeErr.Error(), "output": writeOutput})
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

	cfg, resolveErr := resolveTerminalConfig(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	unitPath, pathErr := resolveSystemdUnitPath(e.Request.Context(), cfg, service)
	if pathErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": pathErr.Error()})
	}

	verifyCmd := fmt.Sprintf("(sudo -n systemd-analyze verify %s || systemd-analyze verify %s)", terminal.ShellQuote(unitPath), terminal.ShellQuote(unitPath))
	verifyOutput, verifyErr := terminal.ExecuteSSHCommand(e.Request.Context(), cfg, verifyCmd, 25*time.Second)

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

	cfg, resolveErr := resolveTerminalConfig(e.App, e.Auth, serverID)
	if resolveErr != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": resolveErr.Error()})
	}

	reloadCmd := "(sudo -n systemctl daemon-reload || systemctl daemon-reload)"
	reloadOutput, reloadErr := terminal.ExecuteSSHCommand(e.Request.Context(), cfg, reloadCmd, 20*time.Second)
	if reloadErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": reloadErr.Error(), "reload_output": reloadOutput})
	}

	applyCmd := fmt.Sprintf("(sudo -n systemctl try-restart %s || systemctl try-restart %s)", service, service)
	applyOutput, applyErr := terminal.ExecuteSSHCommand(e.Request.Context(), cfg, applyCmd, 25*time.Second)

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

func resolveSystemdUnitPath(ctx context.Context, cfg terminal.ConnectorConfig, service string) (string, error) {
	cmd := fmt.Sprintf("systemctl show %s --property=FragmentPath --value --no-pager", service)
	raw, err := terminal.ExecuteSSHCommand(ctx, cfg, cmd, 20*time.Second)
	if err != nil {
		return "", err
	}
	unitPath := strings.TrimSpace(raw)
	if unitPath == "" || unitPath == "/dev/null" {
		return "", fmt.Errorf("systemd unit file not found")
	}
	return unitPath, nil
}
