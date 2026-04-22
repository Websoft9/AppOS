package servers

import (
	"time"

	"github.com/pocketbase/pocketbase/core"
	tunnelcore "github.com/websoft9/appos/backend/infra/tunnelcore"
)

type AccessView struct {
	Status    string `json:"status"`
	Reason    string `json:"reason"`
	CheckedAt string `json:"checked_at"`
	Source    string `json:"source"`
}

type TunnelView struct {
	State       string `json:"state"`
	LastSeen    string `json:"last_seen"`
	ConnectedAt string `json:"connected_at"`
	PauseUntil  string `json:"pause_until"`
	Status      string `json:"status"`
	Reason      string `json:"reason"`
	IsPaused    bool   `json:"is_paused"`
	Waiting     bool   `json:"waiting_for_first_connect"`
	Services    []tunnelcore.Service `json:"services,omitempty"`
}

type ServerViewItem struct {
	ID             string      `json:"id"`
	Name           string      `json:"name"`
	Host           string      `json:"host"`
	Port           int         `json:"port"`
	User           string      `json:"user"`
	CreatedBy      string      `json:"created_by"`
	CreatedByName  string      `json:"created_by_name"`
	ConnectType    string      `json:"connect_type"`
	Credential     string      `json:"credential"`
	CredentialType string      `json:"credential_type"`
	Description    string      `json:"description"`
	Created        string      `json:"created"`
	Updated        string      `json:"updated"`
	Access         AccessView  `json:"access"`
	Tunnel         *TunnelView `json:"tunnel,omitempty"`
}

func BuildServerViewItem(record *core.Record, credentialType string, createdByName string, sessions *tunnelcore.Registry) ServerViewItem {
	managed := ManagedServerFromRecord(record)
	item := ServerViewItem{
		ID:             record.Id,
		Name:           managed.Name,
		Host:           managed.Host,
		Port:           managed.Port,
		User:           managed.User,
		CreatedBy:      record.GetString("created_by"),
		CreatedByName:  createdByName,
		ConnectType:    string(managed.ConnectType),
		Credential:     managed.CredentialID,
		CredentialType: credentialType,
		Description:    managed.Description,
		Created:        recordDateTime(record, "created").Format(time.RFC3339),
		Updated:        recordDateTime(record, "updated").Format(time.RFC3339),
		Access: AccessView{
			Status: "unknown",
			Reason: "",
			Source: "derived",
		},
	}

	if item.Created == "0001-01-01T00:00:00Z" {
		item.Created = ""
	}
	if item.Updated == "0001-01-01T00:00:00Z" {
		item.Updated = ""
	}

	if managed.ConnectType != ConnectionModeTunnel {
		return item
	}

	tunnelView, access := buildTunnelViews(managed, TunnelRuntimeFromRecord(record), sessions)
	item.Access = access
	item.Tunnel = &tunnelView
	return item
}

func buildTunnelViews(server *ManagedServer, runtime TunnelRuntime, sessions *tunnelcore.Registry) (TunnelView, AccessView) {
	now := time.Now().UTC()
	status := runtime.Status
	connectedAt := runtime.ConnectedAt
	lastSeen := runtime.LastSeen
	disconnectAt := runtime.DisconnectAt
	pauseUntil := runtime.PauseUntil
	reason := runtime.DisconnectReason

	if sessions != nil {
		if session, ok := sessions.Get(server.ID); ok {
			status = TunnelStatusOnline
			connectedAt = session.ConnectedAt.UTC()
			lastSeen = connectedAt
			reason = ""
		}
	}

	waiting := status != TunnelStatusOnline && connectedAt.IsZero() && lastSeen.IsZero() && disconnectAt.IsZero()
	isPaused := pauseUntil.After(now) && status != TunnelStatusOnline
	if isPaused {
		status = TunnelStatusPaused
	}

	tunnelState := "ready"
	access := AccessView{
		Status:    "unavailable",
		Reason:    "tunnel_offline",
		CheckedAt: latestTunnelCheckAt(status, lastSeen, connectedAt, disconnectAt),
		Source:    "tunnel_runtime",
	}

	switch {
	case waiting:
		tunnelState = "setup_required"
		access.Reason = "waiting_for_first_connect"
		access.CheckedAt = ""
	case status == TunnelStatusOnline:
		access.Status = "available"
		access.Reason = ""
		access.CheckedAt = latestTunnelCheckAt(status, lastSeen, connectedAt, disconnectAt)
	case status == TunnelStatusPaused:
		tunnelState = "paused"
		access.Reason = "paused"
	default:
		tunnelState = "ready"
	}

	return TunnelView{
		State:       tunnelState,
		LastSeen:    FormatTunnelTime(lastSeen),
		ConnectedAt: FormatTunnelTime(connectedAt),
		PauseUntil:  FormatTunnelTime(pauseUntil),
		Status:      string(status),
		Reason:      reason,
		IsPaused:    isPaused,
		Waiting:     waiting,
		Services:    runtime.Services(),
	}, access
}

func latestTunnelCheckAt(status TunnelStatus, lastSeen time.Time, connectedAt time.Time, disconnectAt time.Time) string {
	if status == TunnelStatusOnline {
		if !lastSeen.IsZero() {
			return FormatTunnelTime(lastSeen)
		}
		return FormatTunnelTime(connectedAt)
	}
	if !disconnectAt.IsZero() {
		return FormatTunnelTime(disconnectAt)
	}
	if !lastSeen.IsZero() {
		return FormatTunnelTime(lastSeen)
	}
	return FormatTunnelTime(connectedAt)
}