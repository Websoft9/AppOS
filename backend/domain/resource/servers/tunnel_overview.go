package servers

import (
	"fmt"
	"math"
	"strings"
	"time"

	tunnelcore "github.com/websoft9/appos/backend/infra/tunnelcore"
)

// BuildTunnelOverviewItem assembles the JSON summary map for one tunnel server.
// server carries catalog identity; rt carries the persisted runtime state.
// sessions overlays live in-memory state when the tunnel is actively connected.
func BuildTunnelOverviewItem(server *ManagedServer, rt TunnelRuntime, groupNames []string, sessions *tunnelcore.Registry) map[string]any {
	status := rt.Status
	connectedAtTime := rt.ConnectedAt
	lastSeenTime := rt.LastSeen
	disconnectAtTime := rt.DisconnectAt
	pauseUntilTime := rt.PauseUntil
	remoteAddr := rt.RemoteAddr
	services := rt.Services()
	disconnectReason := rt.DisconnectReason
	if len(groupNames) == 0 {
		groupNames = []string{}
	}

	if sessions != nil {
		if sess, ok := sessions.Get(server.ID); ok {
			status = TunnelStatusOnline
			connectedAtTime = sess.ConnectedAt.UTC()
			lastSeenTime = connectedAtTime
			services = sess.Services
			disconnectReason = ""
			if sess.Conn != nil && sess.Conn.RemoteAddr() != nil {
				remoteAddr = sess.Conn.RemoteAddr().String()
			}
		}
	}
	if pauseUntilTime.After(time.Now().UTC()) && status != TunnelStatusOnline {
		status = TunnelStatusPaused
	}

	connectionDurationSeconds, connectionDurationLabel := tunnelConnectionDuration(string(status), connectedAtTime, disconnectAtTime, lastSeenTime)
	sessionDurationHours := tunnelSessionDurationHours(string(status), connectedAtTime, disconnectAtTime, lastSeenTime)

	return map[string]any{
		"id":                          server.ID,
		"name":                        server.Name,
		"description":                 server.Description,
		"status":                      string(status),
		"created":                     FormatTunnelTime(connectedAtTime),
		"connected_at":                FormatTunnelTime(connectedAtTime),
		"last_seen":                   FormatTunnelTime(lastSeenTime),
		"remote_addr":                 remoteAddr,
		"disconnect_at":               FormatTunnelTime(disconnectAtTime),
		"disconnect_reason":           disconnectReason,
		"disconnect_reason_label":     TunnelDisconnectReasonLabel(disconnectReason),
		"pause_until":                 FormatTunnelTime(pauseUntilTime),
		"is_paused":                   pauseUntilTime.After(time.Now().UTC()),
		"connection_duration_seconds": connectionDurationSeconds,
		"connection_duration_label":   connectionDurationLabel,
		"session_duration_hours":      sessionDurationHours,
		"session_duration_label":      formatTunnelHours(sessionDurationHours),
		"services":                    services,
		"group_names":                 groupNames,
		"waiting_for_first_connect":   rt.WaitingForFirstConnect(),
	}
}

func FormatTunnelTime(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}

func TunnelDisconnectReasonLabel(reason string) string {
	switch tunnelcore.DisconnectReason(reason) {
	case tunnelcore.DisconnectReasonOperatorDisconnect:
		return "Disconnected by operator"
	case tunnelcore.DisconnectReasonPausedByOperator:
		return "Paused by operator"
	case tunnelcore.DisconnectReasonTokenRotated:
		return "Token rotated"
	case tunnelcore.DisconnectReasonSessionReplaced:
		return "Replaced by newer session"
	case tunnelcore.DisconnectReasonKeepaliveTimeout:
		return "Keepalive timeout"
	case tunnelcore.DisconnectReasonConnectionError:
		return "Connection error"
	case tunnelcore.DisconnectReasonConnectionClosed:
		return "Connection closed"
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
