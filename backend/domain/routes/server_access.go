package routes

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/proxy"
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

func resolveTerminalConfigWithProxy(app core.App, auth *core.Record, serverID string) (terminal.ConnectorConfig, map[string]string, error) {
	cfg, err := resolveTerminalConfig(app, auth, serverID)
	if err != nil {
		return terminal.ConnectorConfig{}, nil, err
	}
	env, err := resolveServerRemoteShellProxyEnv(app, serverID)
	if err != nil {
		return terminal.ConnectorConfig{}, nil, err
	}
	return cfg, env, nil
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

func resolveServerRemoteShellProxyEnv(app core.App, serverID string) (map[string]string, error) {
	serverID = strings.TrimSpace(serverID)
	if app == nil || serverID == "" || serverID == "local" {
		return nil, nil
	}
	record, err := app.FindRecordById("servers", serverID)
	if err != nil {
		return nil, err
	}
	if serverRecordIsLocal(record) {
		return nil, nil
	}
	return proxy.ProxyEnvForRemoteShellServer(app, serverID)
}

func serverRecordIsLocal(record *core.Record) bool {
	if record == nil {
		return false
	}
	raw := record.Get("is_local")
	switch value := raw.(type) {
	case bool:
		return value
	case string:
		normalized := strings.TrimSpace(strings.ToLower(value))
		return normalized == "true" || normalized == "1" || normalized == "yes" || normalized == "on"
	default:
		return false
	}
}
