package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/infra/docker"
	sec "github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/domain/servers"
)

type SFTPClient interface {
	MkdirAll(path string) error
	WriteFile(path string, content string) error
	Close() error
}

type serverConfigResolver func(app core.App, serverID string) (servers.ConnectorConfig, error)

type sftpClientFactory func(ctx context.Context, cfg servers.ConnectorConfig) (SFTPClient, error)

var defaultServerConfigResolver serverConfigResolver = resolveServerConfig

var defaultSFTPClientFactory sftpClientFactory = func(ctx context.Context, cfg servers.ConnectorConfig) (SFTPClient, error) {
	return servers.NewSFTPClient(ctx, cfg)
}

type Executor interface {
	PrepareWorkspace(projectDir string, compose string) error
	DockerClient() (*docker.Client, error)
	Name() string
}

type localExecutor struct{}

func (e localExecutor) PrepareWorkspace(projectDir string, compose string) error {
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(projectDir, "docker-compose.yml"), []byte(compose), 0o644)
}

func (e localExecutor) DockerClient() (*docker.Client, error) {
	exec := docker.NewLocalExecutor("")
	if os.Getuid() != 0 {
		exec.SudoEnabled = true
	}
	return docker.New(exec), nil
}

func (e localExecutor) Name() string {
	return "local"
}

type sshExecutor struct {
	app           core.App
	serverID      string
	resolveConfig serverConfigResolver
	sftpFactory   sftpClientFactory
}

func (e sshExecutor) PrepareWorkspace(projectDir string, compose string) error {
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

func (e sshExecutor) DockerClient() (*docker.Client, error) {
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

func (e sshExecutor) Name() string {
	return "ssh"
}

func (e sshExecutor) resolver() serverConfigResolver {
	if e.resolveConfig != nil {
		return e.resolveConfig
	}
	return defaultServerConfigResolver
}

func (e sshExecutor) factory() sftpClientFactory {
	if e.sftpFactory != nil {
		return e.sftpFactory
	}
	return defaultSFTPClientFactory
}

func executorName(serverID string) string {
	if serverID == "" || serverID == "local" {
		return "local"
	}
	return "ssh"
}

func NewDeploymentExecutor(app core.App, serverID string) Executor {
	if executorName(serverID) == "local" {
		return localExecutor{}
	}
	return newSSHExecutor(app, serverID)
}

func newSSHExecutor(app core.App, serverID string) sshExecutor {
	return sshExecutor{
		app:           app,
		serverID:      serverID,
		resolveConfig: defaultServerConfigResolver,
		sftpFactory:   defaultSFTPClientFactory,
	}
}

func resolveServerConfig(app core.App, serverID string) (servers.ConnectorConfig, error) {
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

	if err := applyCredentialConfig(app, server, &cfg); err != nil {
		return cfg, err
	}
	if err := applyTunnelConfig(server, &cfg); err != nil {
		return cfg, err
	}

	return cfg, nil
}

func applyCredentialConfig(app core.App, server *core.Record, cfg *servers.ConnectorConfig) error {
	credID := server.GetString("credential")
	if credID == "" {
		return nil
	}

	cfg.AuthType = credentialAuthType(app, credID)
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

func applyTunnelConfig(server *core.Record, cfg *servers.ConnectorConfig) error {
	if !strings.EqualFold(server.GetString("connect_type"), "tunnel") {
		return nil
	}

	sshPort, err := tunnelSSHPort(server.GetString("tunnel_services"))
	if err != nil {
		return err
	}
	cfg.Host = "127.0.0.1"
	cfg.Port = sshPort
	return nil
}

func credentialAuthType(app core.App, credID string) string {
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

func tunnelSSHPort(raw string) (int, error) {
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