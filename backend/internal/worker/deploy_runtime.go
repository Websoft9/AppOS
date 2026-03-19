package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/internal/docker"
	sec "github.com/websoft9/appos/backend/internal/secrets"
	"github.com/websoft9/appos/backend/internal/servers"
)

func resolveDeploymentServerConfig(app core.App, serverID string) (servers.ConnectorConfig, error) {
	var cfg servers.ConnectorConfig

	server, err := app.FindRecordById("servers", serverID)
	if err != nil {
		return cfg, fmt.Errorf("server not found: %w", err)
	}

	cfg.Host = server.GetString("host")
	cfg.Port = server.GetInt("port")
	if cfg.Port == 0 {
		cfg.Port = 22
	}
	cfg.User = server.GetString("user")
	cfg.Shell = server.GetString("shell")

	credID := server.GetString("credential")
	if credID != "" {
		cfg.AuthType = deploymentCredAuthType(app, credID)
		payload, resolveErr := sec.Resolve(app, credID, "")
		if resolveErr != nil {
			return cfg, fmt.Errorf("credential resolve failed: %w", resolveErr)
		}
		switch cfg.AuthType {
		case "password":
			cfg.Secret = sec.FirstStringFromPayload(payload, "password", "value")
		default:
			cfg.Secret = sec.FirstStringFromPayload(payload, "private_key", "key", "value")
		}
		if cfg.Secret == "" {
			return cfg, fmt.Errorf("credential resolve: no usable value for auth_type %q", cfg.AuthType)
		}
	}

	if strings.EqualFold(server.GetString("connect_type"), "tunnel") {
		sshPort, portErr := deploymentTunnelSSHPort(server.GetString("tunnel_services"))
		if portErr != nil {
			return cfg, portErr
		}
		cfg.Host = "127.0.0.1"
		cfg.Port = sshPort
	}

	return cfg, nil
}

func deploymentDockerClient(app core.App, serverID string) (*docker.Client, error) {
	if serverID == "" || serverID == "local" {
		exec := docker.NewLocalExecutor("")
		if os.Getuid() != 0 {
			exec.SudoEnabled = true
		}
		return docker.New(exec), nil
	}

	cfg, err := resolveDeploymentServerConfig(app, serverID)
	if err != nil {
		return nil, err
	}

	sudoEnabled := cfg.User != "root"
	sudoPassword := ""
	if sudoEnabled && cfg.AuthType == "password" {
		sudoPassword = cfg.Secret
	}

	exec := docker.NewSSHExecutor(docker.SSHConfig{
		Host:         cfg.Host,
		Port:         cfg.Port,
		User:         cfg.User,
		AuthType:     cfg.AuthType,
		Secret:       cfg.Secret,
		SudoEnabled:  sudoEnabled,
		SudoPassword: sudoPassword,
	})
	return docker.New(exec), nil
}

func prepareRemoteDeploymentWorkspace(app core.App, serverID string, projectDir string, compose string) error {
	cfg, err := resolveDeploymentServerConfig(app, serverID)
	if err != nil {
		return err
	}

	client, err := servers.NewSFTPClient(context.Background(), cfg)
	if err != nil {
		return err
	}
	defer client.Close()

	if err := client.MkdirAll(projectDir); err != nil {
		return err
	}
	if err := client.WriteFile(filepath.Join(projectDir, "docker-compose.yml"), compose); err != nil {
		return err
	}
	return nil
}

func deploymentCredAuthType(app core.App, credID string) string {
	if credID == "" {
		return ""
	}
	rec, err := app.FindRecordById("secrets", credID)
	if err != nil {
		return ""
	}
	if rec.GetString("template_id") == "ssh_key" {
		return "private_key"
	}
	return "password"
}

func deploymentTunnelSSHPort(raw string) (int, error) {
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