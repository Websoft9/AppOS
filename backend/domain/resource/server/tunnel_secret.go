package servers

import (
	"github.com/pocketbase/pocketbase/core"
	sec "github.com/websoft9/appos/backend/domain/secrets"
)

// FindTunnelTokenSecret loads the tunnel token secret for serverID, including
// the legacy servers.credential fallback used by older records.
func FindTunnelTokenSecret(app core.App, serverID string) (*core.Record, error) {
	secret, err := sec.FindSystemSecretByNameAndType(app, TunnelTokenSecretName(serverID), "tunnel_token")
	if err == nil && secret != nil {
		return secret.Record(), nil
	}

	server, loadErr := LoadManagedServer(app, serverID)
	if loadErr != nil || server == nil || server.CredentialID == "" {
		return nil, nil
	}

	legacy, legacyErr := app.FindRecordById("secrets", server.CredentialID)
	if legacyErr != nil {
		return nil, nil
	}
	if legacy.GetString("type") != "tunnel_token" {
		return nil, nil
	}
	return legacy, nil
}
