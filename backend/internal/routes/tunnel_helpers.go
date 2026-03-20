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

	"github.com/websoft9/appos/backend/internal/tunnel"
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

func loadTunnelForwardSpecs(server *core.Record) ([]tunnel.ForwardSpec, error) {
	raw := server.GetString("tunnel_forwards")
	if raw == "" || raw == "null" {
		return tunnel.DefaultForwardSpecs(), nil
	}
	var forwards []tunnel.ForwardSpec
	if err := json.Unmarshal([]byte(raw), &forwards); err != nil {
		return nil, err
	}
	if len(forwards) == 0 {
		return tunnel.DefaultForwardSpecs(), nil
	}
	return forwards, nil
}

func validateTunnelForwardBody(body []tunnelForwardBody) ([]tunnel.ForwardSpec, error) {
	if len(body) == 0 {
		return nil, fmt.Errorf("at least one forward is required")
	}
	forwards := make([]tunnel.ForwardSpec, 0, len(body))
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
		forwards = append(forwards, tunnel.ForwardSpec{Name: name, LocalPort: item.LocalPort})
	}

	if !hasSSH {
		return nil, fmt.Errorf("an ssh forward on local_port 22 is required")
	}

	return forwards, nil
}

func forwardSpecsToResponse(forwards []tunnel.ForwardSpec) []map[string]any {
	out := make([]map[string]any, 0, len(forwards))
	for _, forward := range forwards {
		out = append(out, map[string]any{
			"service_name": forward.Name,
			"local_port":   forward.LocalPort,
		})
	}
	return out
}

func buildTunnelExecArgs(forwards []tunnel.ForwardSpec, sshPort, token, apposHost string) string {
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

func buildTunnelAutosshCommand(forwards []tunnel.ForwardSpec, sshPort, token, apposHost string) string {
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

func buildTunnelSystemdUnit(forwards []tunnel.ForwardSpec, sshPort, token, apposHost string) string {
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

func buildTunnelOverviewItem(server *core.Record, groupNames []string, sessions *tunnel.Registry) map[string]any {
	status := server.GetString("tunnel_status")
	connectedAtTime := tunnelRecordTime(server, "tunnel_connected_at")
	lastSeenTime := tunnelRecordTime(server, "tunnel_last_seen")
	disconnectAtTime := tunnelRecordTime(server, "tunnel_disconnect_at")
	pauseUntilTime := tunnelPauseUntil(server)
	remoteAddr := server.GetString("tunnel_remote_addr")
	services := parseTunnelServices(server.GetString("tunnel_services"))
	disconnectReason := server.GetString("tunnel_disconnect_reason")
	if len(groupNames) == 0 {
		groupNames = []string{}
	}

	if sessions != nil {
		if sess, ok := sessions.Get(server.Id); ok {
			status = "online"
			connectedAtTime = sess.ConnectedAt.UTC()
			lastSeenTime = connectedAtTime
			services = sess.Services
			disconnectReason = ""
			if sess.Conn != nil && sess.Conn.RemoteAddr() != nil {
				remoteAddr = sess.Conn.RemoteAddr().String()
			}
		}
	}
	if pauseUntilTime.After(time.Now().UTC()) && status != "online" {
		status = "paused"
	}

	connectionDurationSeconds, connectionDurationLabel := tunnelConnectionDuration(status, connectedAtTime, disconnectAtTime, lastSeenTime)
	sessionDurationHours := tunnelSessionDurationHours(status, connectedAtTime, disconnectAtTime, lastSeenTime)

	return map[string]any{
		"id":                          server.Id,
		"name":                        server.GetString("name"),
		"description":                 server.GetString("description"),
		"status":                      status,
		"created":                     formatTunnelTime(connectedAtTime),
		"connected_at":                formatTunnelTime(connectedAtTime),
		"last_seen":                   formatTunnelTime(lastSeenTime),
		"remote_addr":                 remoteAddr,
		"disconnect_at":               formatTunnelTime(disconnectAtTime),
		"disconnect_reason":           disconnectReason,
		"disconnect_reason_label":     tunnelDisconnectReasonLabel(disconnectReason),
		"pause_until":                 formatTunnelTime(pauseUntilTime),
		"is_paused":                   pauseUntilTime.After(time.Now().UTC()),
		"connection_duration_seconds": connectionDurationSeconds,
		"connection_duration_label":   connectionDurationLabel,
		"session_duration_hours":      sessionDurationHours,
		"session_duration_label":      formatTunnelHours(sessionDurationHours),
		"services":                    services,
		"group_names":                 groupNames,
		"waiting_for_first_connect":   isTunnelWaitingForFirstConnect(server),
	}
}

func tunnelPauseUntil(server *core.Record) time.Time {
	return tunnelRecordTime(server, "tunnel_pause_until")
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

func tunnelConnectionDuration(status string, connectedAt time.Time, disconnectAt time.Time, lastSeen time.Time) (int64, string) {
	if connectedAt.IsZero() {
		return 0, ""
	}

	endedAt := time.Now().UTC()
	if status != "online" {
		switch {
		case !disconnectAt.IsZero() && disconnectAt.After(connectedAt):
			endedAt = disconnectAt
		case !lastSeen.IsZero() && lastSeen.After(connectedAt):
			endedAt = lastSeen
		default:
			endedAt = connectedAt
		}
	}

	if endedAt.Before(connectedAt) {
		return 0, ""
	}

	duration := endedAt.Sub(connectedAt)
	seconds := int64(duration / time.Second)
	return seconds, humanizeTunnelDuration(duration)
}

func tunnelSessionDurationHours(status string, connectedAt time.Time, disconnectAt time.Time, lastSeen time.Time) float64 {
	if connectedAt.IsZero() {
		return 0
	}
	endedAt := time.Now().UTC()
	if status != "online" {
		switch {
		case !disconnectAt.IsZero() && disconnectAt.After(connectedAt):
			endedAt = disconnectAt
		case !lastSeen.IsZero() && lastSeen.After(connectedAt):
			endedAt = lastSeen
		default:
			endedAt = connectedAt
		}
	}
	if endedAt.Before(connectedAt) {
		return 0
	}
	hours := endedAt.Sub(connectedAt).Hours()
	if hours < 0 {
		return 0
	}
	return math.Round(hours*10) / 10
}

func formatTunnelHours(value float64) string {
	if value <= 0 {
		return "0.0h"
	}
	return fmt.Sprintf("%.1fh", value)
}

func humanizeTunnelDuration(duration time.Duration) string {
	if duration <= 0 {
		return "0m"
	}

	totalMinutes := int(duration.Round(time.Minute) / time.Minute)
	if totalMinutes < 1 {
		return "<1m"
	}

	days := totalMinutes / (24 * 60)
	totalMinutes -= days * 24 * 60
	hours := totalMinutes / 60
	minutes := totalMinutes % 60

	parts := make([]string, 0, 3)
	if days > 0 {
		parts = append(parts, fmt.Sprintf("%dd", days))
	}
	if hours > 0 {
		parts = append(parts, fmt.Sprintf("%dh", hours))
	}
	if minutes > 0 && len(parts) < 2 {
		parts = append(parts, fmt.Sprintf("%dm", minutes))
	}
	if len(parts) == 0 {
		return "0m"
	}
	return strings.Join(parts, " ")
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
			"at":             formatTunnelTime(created),
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
			"at":           formatTunnelTime(createdAt),
			"action":       action,
			"label":        label,
			"reason":       stringFromAny(detail["reason"]),
			"reason_label": firstNonEmpty(stringFromAny(detail["reason_label"]), tunnelDisconnectReasonLabel(stringFromAny(detail["reason"]))),
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
				"at":           formatTunnelTime(pauseUntilTime),
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

func parseTunnelServices(raw string) []tunnel.Service {
	if raw == "" || raw == "null" {
		return []tunnel.Service{}
	}
	var services []tunnel.Service
	if err := json.Unmarshal([]byte(raw), &services); err != nil {
		return []tunnel.Service{}
	}
	if len(services) == 0 {
		return []tunnel.Service{}
	}
	return services
}

func tunnelDisconnectReasonLabel(reason string) string {
	switch tunnel.DisconnectReason(reason) {
	case tunnel.DisconnectReasonOperatorDisconnect:
		return "Disconnected by operator"
	case tunnel.DisconnectReasonPausedByOperator:
		return "Paused by operator"
	case tunnel.DisconnectReasonTokenRotated:
		return "Token rotated"
	case tunnel.DisconnectReasonSessionReplaced:
		return "Replaced by newer session"
	case tunnel.DisconnectReasonKeepaliveTimeout:
		return "Keepalive timeout"
	case tunnel.DisconnectReasonConnectionError:
		return "Connection error"
	case tunnel.DisconnectReasonConnectionClosed:
		return "Connection closed"
	// Legacy string-format reasons from pre-enum era. Safe to remove once
	// all existing audit_logs rows with these values have aged out.
	case "token rotated":
		return "Token rotated"
	case "disconnected by operator":
		return "Disconnected by operator"
	case "connection closed":
		return "Connection closed"
	case "":
		return ""
	default:
		return strings.ReplaceAll(reason, "_", " ")
	}
}

func isTunnelWaitingForFirstConnect(server *core.Record) bool {
	return server.GetString("tunnel_status") != "online" &&
		server.GetDateTime("tunnel_connected_at").IsZero() &&
		server.GetDateTime("tunnel_last_seen").IsZero() &&
		server.GetDateTime("tunnel_disconnect_at").IsZero()
}

func loadTunnelGroupNames(app core.App, serverIDs []string) (map[string][]string, error) {
	result := map[string][]string{}
	if len(serverIDs) == 0 {
		return result, nil
	}

	serverSet := make(map[string]struct{}, len(serverIDs))
	for _, id := range serverIDs {
		serverSet[id] = struct{}{}
	}

	items, err := app.FindRecordsByFilter(
		"group_items",
		"object_type = 'server'",
		"", 0, 0,
	)
	if err != nil {
		return result, err
	}

	membership := map[string][]string{}
	groupSet := map[string]struct{}{}
	for _, item := range items {
		serverID := item.GetString("object_id")
		if _, ok := serverSet[serverID]; !ok {
			continue
		}
		groupID := item.GetString("group_id")
		if groupID == "" {
			continue
		}
		membership[serverID] = append(membership[serverID], groupID)
		groupSet[groupID] = struct{}{}
	}
	if len(groupSet) == 0 {
		return result, nil
	}

	groups, err := app.FindAllRecords("groups")
	if err != nil {
		return result, err
	}
	nameMap := map[string]string{}
	for _, group := range groups {
		if _, ok := groupSet[group.Id]; ok {
			nameMap[group.Id] = group.GetString("name")
		}
	}

	for serverID, groupIDs := range membership {
		names := make([]string, 0, len(groupIDs))
		for _, groupID := range groupIDs {
			if name := nameMap[groupID]; name != "" {
				names = append(names, name)
			}
		}
		sort.Strings(names)
		result[serverID] = names
	}

	return result, nil
}
