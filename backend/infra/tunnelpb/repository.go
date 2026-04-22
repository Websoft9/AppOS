package tunnelpb

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	sec "github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/infra/tunnelcore"
)

// tunnelRepository is the PocketBase persistence adapter for tunnel metadata,
// token secrets, and last-known session state.
type tunnelRepository struct {
	app core.App
}

func (r tunnelRepository) findManagedServerRecord(managedServerID string) (*core.Record, error) {
	return r.app.FindRecordById("servers", managedServerID)
}

func (r tunnelRepository) findTunnelTokenSecret(managedServerID string) (*core.Record, error) {
	return servers.FindTunnelTokenSecret(r.app, managedServerID)
}

func (r tunnelRepository) findTunnelTokenSecrets() ([]*core.Record, error) {
	return r.app.FindRecordsByFilter(
		"secrets",
		"type = 'tunnel_token' && (payload_encrypted != '' || value != '')",
		"", 0, 0,
	)
}

func (r tunnelRepository) resolveManagedServerID(secret *core.Record) (string, error) {
	if name := secret.GetString("name"); strings.HasPrefix(name, servers.TunnelTokenSecretPrefix) {
		return strings.TrimPrefix(name, servers.TunnelTokenSecretPrefix), nil
	}

	server, err := r.app.FindFirstRecordByFilter(
		"servers",
		"credential = {:cid} && connect_type = 'tunnel'",
		dbx.Params{"cid": secret.Id},
	)
	if err != nil {
		return "", err
	}
	return server.Id, nil
}

func (r tunnelRepository) createTunnelTokenSecret(managedServerID, rawToken string) error {
	_, err := sec.UpsertSystemSingleValue(r.app, nil, servers.TunnelTokenSecretName(managedServerID), "tunnel_token", rawToken)
	return err
}

func (r tunnelRepository) updateTunnelTokenSecret(secret *core.Record, managedServerID, rawToken string) error {
	_, err := sec.UpsertSystemSingleValue(r.app, sec.From(secret), servers.TunnelTokenSecretName(managedServerID), "tunnel_token", rawToken)
	return err
}

func (r tunnelRepository) loadExistingPortRecords() ([]tunnelcore.PortRecord, error) {
	records, err := r.app.FindAllRecords("servers")
	if err != nil {
		return nil, err
	}

	portRecords := make([]tunnelcore.PortRecord, 0, len(records))
	for _, record := range records {
		managed := servers.ManagedServerFromRecord(record)
		if managed == nil || !managed.IsTunnel() {
			continue
		}
		rt := servers.TunnelRuntimeFromRecord(record)
		services := rt.Services()
		if len(services) == 0 {
			continue
		}
		portRecords = append(portRecords, tunnelcore.PortRecord{ClientID: managed.ID, Services: services})
	}

	return portRecords, nil
}

func (r tunnelRepository) saveConnectedState(managedServerID string, connectedAt time.Time, remoteAddr string, services []tunnelcore.Service) error {
	server, err := r.findManagedServerRecord(managedServerID)
	if err != nil {
		return err
	}

	svcJSON, err := json.Marshal(services)
	if err != nil {
		return fmt.Errorf("marshal services: %w", err)
	}
	now := time.Now().UTC()
	server.Set("tunnel_status", string(servers.TunnelStatusOnline))
	server.Set("tunnel_last_seen", now)
	server.Set("tunnel_connected_at", connectedAt)
	server.Set("tunnel_remote_addr", remoteAddr)
	server.Set("tunnel_disconnect_at", nil)
	server.Set("tunnel_disconnect_reason", "")
	server.Set("tunnel_pause_until", nil)
	server.Set("tunnel_services", string(svcJSON))
	return r.app.Save(server)
}

func (r tunnelRepository) saveDisconnectedState(managedServerID string, reason tunnelcore.DisconnectReason, disconnectAt time.Time) error {
	server, err := r.findManagedServerRecord(managedServerID)
	if err != nil {
		return err
	}

	server.Set("tunnel_status", string(servers.TunnelStatusOffline))
	server.Set("tunnel_disconnect_at", disconnectAt)
	server.Set("tunnel_disconnect_reason", string(reason))
	return r.app.Save(server)
}
