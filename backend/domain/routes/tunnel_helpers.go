package routes

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/websoft9/appos/backend/domain/groups"
	servers "github.com/websoft9/appos/backend/domain/resource/server"
	tunnelcore "github.com/websoft9/appos/backend/infra/tunnelcore"
)

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

func validateTunnelForwardBody(body []tunnelForwardBody) ([]tunnelcore.ForwardSpec, error) {
	if len(body) == 0 {
		return nil, fmt.Errorf("at least one forward is required")
	}
	forwards := make([]tunnelcore.ForwardSpec, 0, len(body))
	seenNames := make(map[string]struct{}, len(body))
	seenPorts := make(map[int]struct{}, len(body))
	hasSSH := false

	for _, item := range body {
		name := strings.TrimSpace(item.ServiceName)
		if name == "" {
			return nil, fmt.Errorf("service_name is required")
		}
		if item.LocalPort < 1 || item.LocalPort > 65535 {
			return nil, fmt.Errorf("local_port must be between 1 and 65535")
		}
		if _, exists := seenNames[name]; exists {
			return nil, fmt.Errorf("duplicate service_name: %s", name)
		}
		if _, exists := seenPorts[item.LocalPort]; exists {
			return nil, fmt.Errorf("duplicate local_port: %d", item.LocalPort)
		}
		if name == "ssh" && item.LocalPort == 22 {
			hasSSH = true
		}
		seenNames[name] = struct{}{}
		seenPorts[item.LocalPort] = struct{}{}
		forwards = append(forwards, tunnelcore.ForwardSpec{Name: name, LocalPort: item.LocalPort})
	}

	if !hasSSH {
		return nil, fmt.Errorf("an ssh forward on local_port 22 is required")
	}

	return forwards, nil
}

func forwardSpecsToResponse(forwards []tunnelcore.ForwardSpec) []map[string]any {
	out := make([]map[string]any, 0, len(forwards))
	for _, forward := range forwards {
		out = append(out, map[string]any{
			"service_name": forward.Name,
			"local_port":   forward.LocalPort,
		})
	}
	return out
}

func buildTunnelExecArgs(forwards []tunnelcore.ForwardSpec, sshPort, token, apposHost string) string {
	parts := []string{"-M 0", "-N"}
	for _, forward := range forwards {
		parts = append(parts, fmt.Sprintf("-R 0:localhost:%d", forward.LocalPort))
	}
	parts = append(parts,
		fmt.Sprintf("-p %s", sshPort),
		fmt.Sprintf("%s@%s", token, apposHost),
		"-o ServerAliveInterval=30",
		"-o ServerAliveCountMax=3",
		"-o StrictHostKeyChecking=no",
		"-o UserKnownHostsFile=/dev/null",
		"-o ExitOnForwardFailure=yes",
	)
	return strings.Join(parts, " ")
}

func buildTunnelAutosshCommand(forwards []tunnelcore.ForwardSpec, sshPort, token, apposHost string) string {
	cont := " " + string('\\')
	lines := []string{"autossh -M 0 -N" + cont}
	for _, forward := range forwards {
		lines = append(lines, fmt.Sprintf("  -R 0:localhost:%d%s", forward.LocalPort, cont))
	}
	lines = append(lines,
		fmt.Sprintf("  -p %s %s@%s%s", sshPort, token, apposHost, cont),
		"  -o ServerAliveInterval=30"+cont,
		"  -o ServerAliveCountMax=3"+cont,
		"  -o StrictHostKeyChecking=no"+cont,
		"  -o UserKnownHostsFile=/dev/null"+cont,
		"  -o ExitOnForwardFailure=yes",
	)
	return strings.Join(lines, "\n")
}

func buildTunnelSystemdUnit(forwards []tunnelcore.ForwardSpec, sshPort, token, apposHost string) string {
	args := strings.ReplaceAll(buildTunnelAutosshCommand(forwards, sshPort, token, apposHost), "autossh ", "")
	return fmt.Sprintf(`[Unit]
Description=appos reverse SSH tunnel
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
Environment=AUTOSSH_GATETIME=0
ExecStart=/usr/bin/autossh %s
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target`, args)
}

func tunnelPauseUntil(server *core.Record) time.Time {
	return servers.TunnelRuntimeFromRecord(server).PauseUntil
}

func formatTunnelTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}

func tunnelRecordTime(server *core.Record, field string) time.Time {
	value := server.GetDateTime(field)
	if value.IsZero() {
		return time.Time{}
	}
	return value.Time().UTC()
}

func loadRecentTunnelReconnectInfo(app core.App, serverID string) (map[string]any, error) {
	windowStart := time.Now().UTC().Add(-24 * time.Hour)
	records, err := app.FindRecordsByFilter(
		"audit_logs",
		"action = {:action} && resource_type = 'server' && resource_id = {:resourceId} && created >= {:windowStart}",
		"-created",
		0,
		0,
		dbx.Params{"action": "tunnel.connect", "resourceId": serverID, "windowStart": windowStart.Format(time.RFC3339)},
	)
	if err != nil {
		return nil, err
	}
	recentReconnects := make([]map[string]any, 0, 3)
	reconnectCount24h := len(records)

	for _, record := range records {
		created := tunnelRecordTime(record, "created")

		if len(recentReconnects) >= 3 {
			continue
		}

		detail := normalizeTunnelAuditDetail(record.Get("detail"))
		remoteAddr, _ := detail["remote_addr"].(string)
		recentReconnects = append(recentReconnects, map[string]any{
			"at":             servers.FormatTunnelTime(created),
			"remote_addr":    remoteAddr,
			"services_count": intFromAny(detail["services_count"]),
		})
	}

	lastReconnectAt := ""
	if len(recentReconnects) > 0 {
		if value, ok := recentReconnects[0]["at"].(string); ok {
			lastReconnectAt = value
		}
	}

	return map[string]any{
		"last_reconnect_at":          lastReconnectAt,
		"recent_reconnect_count_24h": reconnectCount24h,
		"recent_reconnects":          recentReconnects,
	}, nil
}

func loadTunnelConnectionLogs(app core.App, serverID string) ([]map[string]any, error) {
	records, err := app.FindRecordsByFilter(
		"audit_logs",
		"resource_type = 'server' && resource_id = {:resourceId} && (action = {:connect} || action = {:disconnect} || action = {:pause} || action = {:resume} || action = {:rotate} || action = {:rejected})",
		"-created",
		200,
		0,
		dbx.Params{
			"resourceId": serverID,
			"connect":    "tunnel.connect",
			"disconnect": "tunnel.disconnect",
			"pause":      "tunnel.pause",
			"resume":     "tunnel.resume",
			"rotate":     "tunnel.token_rotated",
			"rejected":   "tunnel.connect_rejected",
		},
	)
	if err != nil {
		return nil, err
	}

	type rawTunnelLog struct {
		record     *core.Record
		action     string
		createdAt  time.Time
		detail     map[string]any
		pauseUntil string
	}

	rawLogs := make([]rawTunnelLog, 0, len(records))
	resumeTimes := make([]time.Time, 0, len(records))
	connectCount := 0
	for _, record := range records {
		action := record.GetString("action")
		createdAt := tunnelRecordTime(record, "created")
		detail := normalizeTunnelAuditDetail(record.Get("detail"))
		pauseUntil := stringFromAny(detail["pause_until"])
		rawLogs = append(rawLogs, rawTunnelLog{
			record:     record,
			action:     action,
			createdAt:  createdAt,
			detail:     detail,
			pauseUntil: pauseUntil,
		})
		if action == "tunnel.resume" {
			resumeTimes = append(resumeTimes, createdAt)
		}
		if action == "tunnel.connect" {
			connectCount++
		}
	}

	items := make([]map[string]any, 0, len(records))
	remainingConnects := connectCount
	for _, entry := range rawLogs {
		action := entry.action
		createdAt := entry.createdAt
		detail := entry.detail
		pauseUntil := entry.pauseUntil
		minutes := floatFromAny(detail["minutes"])
		if action == "tunnel.pause" && minutes == 0 && pauseUntil != "" && !createdAt.IsZero() {
			if pauseUntilTime, err := time.Parse(time.RFC3339, pauseUntil); err == nil && pauseUntilTime.After(createdAt) {
				minutes = math.Round((pauseUntilTime.Sub(createdAt).Minutes())*10) / 10
			}
		}
		label := tunnelLogActionLabel(action)
		if action == "tunnel.connect" {
			remainingConnects--
			if remainingConnects > 0 {
				label = "Reconnect"
			}
		}
		item := map[string]any{
			"id":           entry.record.Id,
			"at":           servers.FormatTunnelTime(createdAt),
			"action":       action,
			"label":        label,
			"reason":       stringFromAny(detail["reason"]),
			"reason_label": firstNonEmpty(stringFromAny(detail["reason_label"]), servers.TunnelDisconnectReasonLabel(stringFromAny(detail["reason"]))),
			"remote_addr":  stringFromAny(detail["remote_addr"]),
			"pause_until":  pauseUntil,
			"minutes":      minutes,
		}
		items = append(items, item)

		if action == "tunnel.pause" && pauseUntil != "" {
			pauseUntilTime, err := time.Parse(time.RFC3339, pauseUntil)
			if err != nil {
				continue
			}
			if pauseUntilTime.After(time.Now().UTC()) {
				continue
			}
			resumed := false
			for _, resumeAt := range resumeTimes {
				if resumeAt.After(createdAt) && !resumeAt.After(pauseUntilTime) {
					resumed = true
					break
				}
			}
			if resumed {
				continue
			}
			items = append(items, map[string]any{
				"id":           entry.record.Id + "-pause-expired",
				"at":           servers.FormatTunnelTime(pauseUntilTime),
				"action":       "tunnel.pause_expired",
				"label":        "Pause expired",
				"reason":       "pause_expired",
				"reason_label": "Pause window elapsed",
				"remote_addr":  "",
				"pause_until":  pauseUntil,
				"minutes":      minutes,
			})
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		return stringFromAny(items[i]["at"]) > stringFromAny(items[j]["at"])
	})
	return items, nil
}

func tunnelLogActionLabel(action string) string {
	switch action {
	case "tunnel.connect":
		return "Connected"
	case "tunnel.disconnect":
		return "Disconnected"
	case "tunnel.pause":
		return "Pause started"
	case "tunnel.resume":
		return "Connect resumed"
	case "tunnel.token_rotated":
		return "Token rotated"
	case "tunnel.connect_rejected":
		return "Rejected while paused"
	default:
		return action
	}
}

func stringFromAny(value any) string {
	switch raw := value.(type) {
	case string:
		return raw
	default:
		return ""
	}
}

func floatFromAny(value any) float64 {
	switch raw := value.(type) {
	case float64:
		return raw
	case float32:
		return float64(raw)
	case int:
		return float64(raw)
	case int64:
		return float64(raw)
	case string:
		parsed, err := strconv.ParseFloat(raw, 64)
		if err == nil {
			return parsed
		}
	default:
		return 0
	}
	return 0
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func normalizeTunnelAuditDetail(value any) map[string]any {
	switch detail := value.(type) {
	case map[string]any:
		return detail
	case []byte:
		if len(detail) == 0 {
			return map[string]any{}
		}
		var parsed map[string]any
		if err := json.Unmarshal(detail, &parsed); err == nil {
			return parsed
		}
	case string:
		if detail == "" {
			return map[string]any{}
		}
		var parsed map[string]any
		if err := json.Unmarshal([]byte(detail), &parsed); err == nil {
			return parsed
		}
	}
	if value == nil {
		return map[string]any{}
	}
	raw, err := json.Marshal(value)
	if err != nil || len(raw) == 0 || string(raw) == "null" {
		return map[string]any{}
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err == nil {
		return parsed
	}
	return map[string]any{}
}

func intFromAny(value any) int {
	switch raw := value.(type) {
	case int:
		return raw
	case int32:
		return int(raw)
	case int64:
		return int(raw)
	case float64:
		return int(raw)
	default:
		return 0
	}
}

func parseTunnelServices(raw string) []tunnelcore.Service {
	return servers.TunnelRuntime{ServicesRaw: raw}.Services()
}

func isTunnelWaitingForFirstConnect(server *core.Record) bool {
	return servers.TunnelRuntimeFromRecord(server).WaitingForFirstConnect()
}

func loadTunnelGroupNames(app core.App, serverIDs []string) (map[string][]string, error) {
	return groups.LoadNamesForObjects(app, groups.ObjectTypeServer, serverIDs)
}
