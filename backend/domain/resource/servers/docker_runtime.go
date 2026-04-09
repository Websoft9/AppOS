package servers

import (
	"encoding/json"
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/infra/docker"
)

// NewDockerClient returns a Docker client bound to the requested server.
// When serverID is empty or "local", the provided localClient is returned.
func NewDockerClient(app core.App, serverID string, localClient *docker.Client) (*docker.Client, error) {
	if serverID == "" || serverID == "local" {
		return localClient, nil
	}

	server, err := LoadManagedServer(app, serverID)
	if err != nil {
		return nil, err
	}

	sshConfig, err := server.DockerSSHConfig(app, "")
	if err != nil {
		return nil, err
	}
	return docker.New(docker.NewSSHExecutor(sshConfig)), nil
}

// ResolveDockerSSHConfig builds the SSH config from an already-loaded record,
// avoiding an extra DB call compared to DockerSSHConfig.
func ResolveDockerSSHConfig(app core.App, serverRec *core.Record, userID string) (docker.SSHConfig, error) {
	server := ManagedServerFromRecord(serverRec)
	if server == nil {
		return docker.SSHConfig{}, fmt.Errorf("server record is required")
	}
	rt := TunnelRuntimeFromRecord(serverRec)
	return server.buildDockerSSHConfig(app, rt, userID)
}

// DockerSSHConfig builds the SSH configuration needed for Docker operations.
// It loads the current TunnelRuntime from the DB so that tunnel-backed servers
// resolve to their live forwarding address.
func (s *ManagedServer) DockerSSHConfig(app core.App, userID string) (docker.SSHConfig, error) {
	if s == nil {
		return docker.SSHConfig{}, fmt.Errorf("server is required")
	}

	record, err := app.FindRecordById("servers", s.ID)
	if err != nil {
		return docker.SSHConfig{}, fmt.Errorf("server not found: %w", err)
	}
	rt := TunnelRuntimeFromRecord(record)
	return s.buildDockerSSHConfig(app, rt, userID)
}

func (s *ManagedServer) buildDockerSSHConfig(app core.App, rt TunnelRuntime, userID string) (docker.SSHConfig, error) {
	host, port, err := s.ResolveDockerSSHAddress(rt)
	if err != nil {
		return docker.SSHConfig{}, err
	}

	cfg, err := s.AccessConfig(app, userID)
	if err != nil {
		return docker.SSHConfig{}, err
	}

	sudoEnabled := cfg.User != "root"
	sudoPassword := ""
	if sudoEnabled && cfg.AuthType == AuthMethodPassword {
		sudoPassword = cfg.Secret
	}

	return docker.SSHConfig{
		Host:         host,
		Port:         port,
		User:         cfg.User,
		AuthType:     string(cfg.AuthType),
		Secret:       cfg.Secret,
		SudoEnabled:  sudoEnabled,
		SudoPassword: sudoPassword,
	}, nil
}

// ResolveDockerSSHAddress rewrites tunnel-backed servers to their active local forwarding address.
func ResolveDockerSSHAddress(serverRec *core.Record) (string, int, error) {
	server := ManagedServerFromRecord(serverRec)
	if server == nil {
		return "", 0, fmt.Errorf("server record is required")
	}
	rt := TunnelRuntimeFromRecord(serverRec)
	return server.ResolveDockerSSHAddress(rt)
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
