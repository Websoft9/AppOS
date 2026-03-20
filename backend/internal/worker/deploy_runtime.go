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

type deploymentSFTPClient interface {
	MkdirAll(path string) error
	WriteFile(path string, content string) error
	Close() error
}

type deploymentServerConfigResolver func(app core.App, serverID string) (servers.ConnectorConfig, error)

type deploymentSFTPClientFactory func(ctx context.Context, cfg servers.ConnectorConfig) (deploymentSFTPClient, error)

var defaultDeploymentServerConfigResolver deploymentServerConfigResolver = resolveDeploymentServerConfig

var defaultDeploymentSFTPClientFactory deploymentSFTPClientFactory = func(ctx context.Context, cfg servers.ConnectorConfig) (deploymentSFTPClient, error) {
	return servers.NewSFTPClient(ctx, cfg)
}

type deploymentExecutor interface {
	PrepareWorkspace(projectDir string, compose string) error
	DockerClient() (*docker.Client, error)
	Name() string
}

type localDeploymentExecutor struct{}

func (e localDeploymentExecutor) PrepareWorkspace(projectDir string, compose string) error {
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(projectDir, "docker-compose.yml"), []byte(compose), 0o644)
}

func (e localDeploymentExecutor) DockerClient() (*docker.Client, error) {
	exec := docker.NewLocalExecutor("")
	if os.Getuid() != 0 {
		exec.SudoEnabled = true
	}
	return docker.New(exec), nil
}

func (e localDeploymentExecutor) Name() string {
	return "local"
}

type sshDeploymentExecutor struct {
	app           core.App
	serverID      string
	resolveConfig deploymentServerConfigResolver
	sftpFactory   deploymentSFTPClientFactory
}

func (e sshDeploymentExecutor) PrepareWorkspace(projectDir string, compose string) error {
	cfg, err := e.resolver()(e.app, e.serverID)
	if err != nil {
		return err
	}

	client, err := e.factory()(context.Background(), cfg)
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

func (e sshDeploymentExecutor) DockerClient() (*docker.Client, error) {
	cfg, err := e.resolver()(e.app, e.serverID)
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

func (e sshDeploymentExecutor) Name() string {
	return "ssh"
}

func (e sshDeploymentExecutor) resolver() deploymentServerConfigResolver {
	if e.resolveConfig != nil {
		return e.resolveConfig
	}
	return defaultDeploymentServerConfigResolver
}

func (e sshDeploymentExecutor) factory() deploymentSFTPClientFactory {
	if e.sftpFactory != nil {
		return e.sftpFactory
	}
	return defaultDeploymentSFTPClientFactory
}

func deploymentExecutorName(serverID string) string {
	if serverID == "" || serverID == "local" {
		return "local"
	}
	return "ssh"
}

func newDeploymentExecutor(app core.App, serverID string) deploymentExecutor {
	if deploymentExecutorName(serverID) == "local" {
		return localDeploymentExecutor{}
	}
	return newSSHDeploymentExecutor(app, serverID)
}

func newSSHDeploymentExecutor(app core.App, serverID string) sshDeploymentExecutor {
	return sshDeploymentExecutor{
		app:           app,
		serverID:      serverID,
		resolveConfig: defaultDeploymentServerConfigResolver,
		sftpFactory:   defaultDeploymentSFTPClientFactory,
	}
}

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

	if err := applyDeploymentCredentialConfig(app, server, &cfg); err != nil {
		return cfg, err
	}
	if err := applyDeploymentTunnelConfig(server, &cfg); err != nil {
		return cfg, err
	}

	return cfg, nil
}

func applyDeploymentCredentialConfig(app core.App, server *core.Record, cfg *servers.ConnectorConfig) error {
	credID := server.GetString("credential")
	if credID == "" {
		return nil
	}

	cfg.AuthType = deploymentCredAuthType(app, credID)
	payload, err := sec.Resolve(app, credID, "")
	if err != nil {
		return fmt.Errorf("credential resolve failed: %w", err)
	}

	switch cfg.AuthType {
	case "password":
		cfg.Secret = sec.FirstStringFromPayload(payload, "password", "value")
	default:
		cfg.Secret = sec.FirstStringFromPayload(payload, "private_key", "key", "value")
	}
	if cfg.Secret == "" {
		return fmt.Errorf("credential resolve: no usable value for auth_type %q", cfg.AuthType)
	}

	return nil
}

func applyDeploymentTunnelConfig(server *core.Record, cfg *servers.ConnectorConfig) error {
	if !strings.EqualFold(server.GetString("connect_type"), "tunnel") {
		return nil
	}

	sshPort, err := deploymentTunnelSSHPort(server.GetString("tunnel_services"))
	if err != nil {
		return err
	}
	cfg.Host = "127.0.0.1"
	cfg.Port = sshPort
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