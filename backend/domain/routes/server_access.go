package routes

import (
	"github.com/pocketbase/pocketbase/core"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	"github.com/websoft9/appos/backend/domain/terminal"
)

func resolveTerminalConfig(app core.App, auth *core.Record, serverID string) (terminal.ConnectorConfig, error) {
	access, err := servers.ResolveConfig(app, auth, serverID)
	if err != nil {
		return terminal.ConnectorConfig{}, err
	}
	return terminalConfigFromServerAccess(access), nil
}

func terminalConfigFromServerAccess(access servers.AccessConfig) terminal.ConnectorConfig {
	return terminal.ConnectorConfig{
		Host:     access.Host,
		Port:     access.Port,
		User:     access.User,
		AuthType: terminal.CredAuthType(access.AuthType),
		Secret:   access.Secret,
		Shell:    access.Shell,
	}
}
