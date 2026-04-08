package runtime

import (
	"context"
	"os"
	"path/filepath"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/resource/server"
	"github.com/websoft9/appos/backend/infra/docker"
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
	return servers.ResolveConfigForUserID(app, serverID, "")
}

func tunnelSSHPort(raw string) (int, error) {
	return servers.TunnelSSHPortFromServices(raw)
}