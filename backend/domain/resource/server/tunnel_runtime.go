package servers

import (
	"encoding/json"
	"time"

	"github.com/pocketbase/pocketbase/core"
	tunnelcore "github.com/websoft9/appos/backend/infra/tunnelcore"
)

type TunnelRuntime struct {
	Status           string
	LastSeen         time.Time
	ConnectedAt      time.Time
	RemoteAddr       string
	DisconnectAt     time.Time
	DisconnectReason string
	PauseUntil       time.Time
	ServicesRaw      string
}

func TunnelRuntimeFromRecord(record *core.Record) TunnelRuntime {
	if record == nil {
		return TunnelRuntime{}
	}

	return TunnelRuntime{
		Status:           record.GetString("tunnel_status"),
		LastSeen:         recordDateTime(record, "tunnel_last_seen"),
		ConnectedAt:      recordDateTime(record, "tunnel_connected_at"),
		RemoteAddr:       record.GetString("tunnel_remote_addr"),
		DisconnectAt:     recordDateTime(record, "tunnel_disconnect_at"),
		DisconnectReason: record.GetString("tunnel_disconnect_reason"),
		PauseUntil:       recordDateTime(record, "tunnel_pause_until"),
		ServicesRaw:      record.GetString("tunnel_services"),
	}
}

func (r TunnelRuntime) Services() []tunnelcore.Service {
	if r.ServicesRaw == "" || r.ServicesRaw == "null" {
		return []tunnelcore.Service{}
	}

	var services []tunnelcore.Service
	if err := json.Unmarshal([]byte(r.ServicesRaw), &services); err != nil {
		return []tunnelcore.Service{}
	}
	if len(services) == 0 {
		return []tunnelcore.Service{}
	}
	return services
}

func (r TunnelRuntime) IsPausedAt(now time.Time) bool {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	return r.PauseUntil.After(now.UTC())
}

func (r TunnelRuntime) WaitingForFirstConnect() bool {
	return r.Status != "online" &&
		r.ConnectedAt.IsZero() &&
		r.LastSeen.IsZero() &&
		r.DisconnectAt.IsZero()
}

func recordDateTime(record *core.Record, field string) time.Time {
	if record == nil {
		return time.Time{}
	}
	value := record.GetDateTime(field)
	if value.IsZero() {
		return time.Time{}
	}
	return value.Time().UTC()
}
