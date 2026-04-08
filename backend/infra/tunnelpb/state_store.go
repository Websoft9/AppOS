package tunnelpb

import (
	"encoding/json"
	"time"

	"github.com/pocketbase/pocketbase/core"
	tunnelcore "github.com/websoft9/appos/backend/infra/tunnelcore"
)

type tunnelStateStore struct {
	app core.App
}

func (s tunnelStateStore) findManagedServerRecord(managedServerID string) (*core.Record, error) {
	return s.app.FindRecordById("servers", managedServerID)
}

func (s tunnelStateStore) saveConnectedState(managedServerID string, connectedAt time.Time, remoteAddr string, services []tunnelcore.Service) error {
	server, err := s.findManagedServerRecord(managedServerID)
	if err != nil {
		return err
	}

	svcJSON, _ := json.Marshal(services)
	now := time.Now().UTC()
	server.Set("tunnel_status", "online")
	server.Set("tunnel_last_seen", now)
	server.Set("tunnel_connected_at", connectedAt)
	server.Set("tunnel_remote_addr", remoteAddr)
	server.Set("tunnel_disconnect_at", nil)
	server.Set("tunnel_disconnect_reason", "")
	server.Set("tunnel_pause_until", nil)
	server.Set("tunnel_services", string(svcJSON))
	return s.app.Save(server)
}

func (s tunnelStateStore) saveDisconnectedState(managedServerID string, reason tunnelcore.DisconnectReason, disconnectAt time.Time) error {
	server, err := s.findManagedServerRecord(managedServerID)
	if err != nil {
		return err
	}

	server.Set("tunnel_status", "offline")
	server.Set("tunnel_disconnect_at", disconnectAt)
	server.Set("tunnel_disconnect_reason", string(reason))
	return s.app.Save(server)
}
