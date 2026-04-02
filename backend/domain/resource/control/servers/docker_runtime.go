package servers

import (
	"encoding/json"
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	sec "github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/infra/docker"
)

// NewDockerClient returns a Docker client bound to the requested server.
// When serverID is empty or "local", the provided localClient is returned.
func NewDockerClient(app core.App, serverID string, localClient *docker.Client) (*docker.Client, error) {
	if serverID == "" || serverID == "local" {
		return localClient, nil
	}

	serverRec, err := app.FindRecordById("servers", serverID)
	if err != nil {
		return nil, fmt.Errorf("server %s not found: %w", serverID, err)
	}

	sshConfig, err := ResolveDockerSSHConfig(app, serverRec, "")
	if err != nil {
		return nil, err
	}
	return docker.New(docker.NewSSHExecutor(sshConfig)), nil
}

// ResolveDockerSSHConfig builds the SSH config used for remote Docker operations.
func ResolveDockerSSHConfig(app core.App, serverRec *core.Record, userID string) (docker.SSHConfig, error) {
	if serverRec == nil {
		return docker.SSHConfig{}, fmt.Errorf("server record is required")
	}

	host, port, err := ResolveDockerSSHAddress(serverRec)
	if err != nil {
		return docker.SSHConfig{}, err
	}

	user := serverRec.GetString("user")
	credentialID := serverRec.GetString("credential")
	authType := CredentialAuthType(app, credentialID)

	secretValue := ""
	if credentialID != "" {
		payload, resolveErr := sec.Resolve(app, credentialID, userID)
		if resolveErr != nil {
			return docker.SSHConfig{}, fmt.Errorf("credential resolve: %w", resolveErr)
		}
		if authType == "password" {
			secretValue = sec.FirstStringFromPayload(payload.Payload, "password", "value")
		} else {
			secretValue = sec.FirstStringFromPayload(payload.Payload, "private_key", "key", "value")
		}
	}

	sudoEnabled := user != "root"
	sudoPassword := ""
	if sudoEnabled && authType == "password" {
		sudoPassword = secretValue
	}

	return docker.SSHConfig{
		Host:         host,
		Port:         port,
		User:         user,
		AuthType:     authType,
		Secret:       secretValue,
		SudoEnabled:  sudoEnabled,
		SudoPassword: sudoPassword,
	}, nil
}

// ResolveDockerSSHAddress rewrites tunnel-backed servers to their active local forwarding address.
func ResolveDockerSSHAddress(serverRec *core.Record) (string, int, error) {
	host := serverRec.GetString("host")
	port := serverRec.GetInt("port")
	if port == 0 {
		port = 22
	}

	if serverRec.GetString("connect_type") != "tunnel" {
		return host, port, nil
	}

	if serverRec.GetString("tunnel_status") != "online" {
		return "", 0, fmt.Errorf("tunnel server %s is offline", serverRec.Id)
	}

	sshPort, err := TunnelSSHPortFromServices(serverRec.GetString("tunnel_services"))
	if err != nil {
		return "", 0, err
	}

	return "127.0.0.1", sshPort, nil
}

// TunnelSSHPortFromServices extracts the SSH forwarding port from tunnel_services JSON.
func TunnelSSHPortFromServices(raw string) (int, error) {
	if raw == "" || raw == "null" {
		return 0, fmt.Errorf("tunnel_services is empty")
	}

	var services []struct {
		Name       string `json:"service_name"`
		TunnelPort int    `json:"tunnel_port"`
	}
	if err := json.Unmarshal([]byte(raw), &services); err != nil {
		return 0, fmt.Errorf("invalid tunnel_services: %w", err)
	}

	for _, svc := range services {
		if svc.Name == "ssh" && svc.TunnelPort > 0 {
			return svc.TunnelPort, nil
		}
	}

	return 0, fmt.Errorf("ssh tunnel service not found")
}
