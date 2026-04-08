package tunnelpb

import (
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	servers "github.com/websoft9/appos/backend/domain/resource/server"
	sec "github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/infra/tunnelcore"
)

type serverStore struct {
	app core.App
}

func (s serverStore) findManagedServerRecord(managedServerID string) (*core.Record, error) {
	return s.app.FindRecordById("servers", managedServerID)
}

func (s serverStore) findTunnelTokenSecret(managedServerID string) (*core.Record, error) {
	return servers.FindTunnelTokenSecret(s.app, managedServerID)
}

func (s serverStore) findTunnelTokenSecrets() ([]*core.Record, error) {
	return s.app.FindRecordsByFilter(
		"secrets",
		"type = 'tunnel_token' && value != ''",
		"", 0, 0,
	)
}

func (s serverStore) resolveManagedServerID(secret *core.Record) (string, error) {
	if name := secret.GetString("name"); strings.HasPrefix(name, servers.TunnelTokenSecretPrefix) {
		return strings.TrimPrefix(name, servers.TunnelTokenSecretPrefix), nil
	}

	server, err := s.app.FindFirstRecordByFilter(
		"servers",
		"credential = {:cid} && connect_type = 'tunnel'",
		dbx.Params{"cid": secret.Id},
	)
	if err != nil {
		return "", err
	}
	return server.Id, nil
}

func (s serverStore) createTunnelTokenSecret(managedServerID, rawToken string) error {
	_, err := sec.UpsertSystemSingleValue(s.app, nil, servers.TunnelTokenSecretName(managedServerID), "tunnel_token", rawToken)
	return err
}

func (s serverStore) updateTunnelTokenSecret(secret *core.Record, managedServerID, rawToken string) error {
	_, err := sec.UpsertSystemSingleValue(s.app, sec.From(secret), servers.TunnelTokenSecretName(managedServerID), "tunnel_token", rawToken)
	return err
}

func (s serverStore) loadExistingPortRecords() ([]tunnelcore.PortRecord, error) {
	existingServers, err := servers.ListManagedServers(s.app)
	if err != nil {
		return nil, err
	}

	portRecords := make([]tunnelcore.PortRecord, 0, len(existingServers))
	for _, rec := range existingServers {
		if !rec.IsTunnel() {
			continue
		}
		runtime := servers.TunnelRuntime{ServicesRaw: rec.TunnelServices}
		services := runtime.Services()
		if len(services) == 0 {
			continue
		}
		portRecords = append(portRecords, tunnelcore.PortRecord{ClientID: rec.ID, Services: services})
	}

	return portRecords, nil
}
