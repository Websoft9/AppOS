package runtime

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/resource/servers"
	"github.com/websoft9/appos/backend/domain/terminal"
	"github.com/websoft9/appos/backend/infra/docker"
)

type SFTPClient interface {
	MkdirAll(path string) error
	WriteFile(path string, content string) error
	Close() error
}

type serverConfigResolver func(app core.App, serverID string) (servers.AccessConfig, error)

type sftpClientFactory func(ctx context.Context, cfg terminal.ConnectorConfig) (SFTPClient, error)

var defaultServerConfigResolver serverConfigResolver = resolveServerAccessConfig

var defaultSFTPClientFactory sftpClientFactory = func(ctx context.Context, cfg terminal.ConnectorConfig) (SFTPClient, error) {
	return terminal.NewSFTPClient(ctx, cfg)
}

type Executor interface {
	PrepareWorkspace(projectDir string, compose string) error
	DockerClient() (*docker.Client, error)
	Name() string
}

type localExecutor struct{}

func (localExecutor) PrepareWorkspace(string, string) error {
	return fmt.Errorf("local workspace preparation is unsupported for this executor")
}

func (localExecutor) DockerClient() (*docker.Client, error) {
	return nil, fmt.Errorf("docker client is unavailable for local lifecycle executor")
}

func (localExecutor) Name() string {
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
	terminalCfg := terminalConfigFromServerAccess(cfg)

	client, err := e.factory()(context.Background(), terminalCfg)
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
	if sudoEnabled && cfg.AuthType == servers.AuthMethodPassword {
		sudoPassword = cfg.Secret
	}

	exec := docker.NewSSHExecutor(docker.SSHConfig{
		Host:         cfg.Host,
		Port:         cfg.Port,
		User:         cfg.User,
		AuthType:     string(cfg.AuthType),
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

func NewDeploymentExecutor(app core.App, serverID string) Executor {
	if serverID == "" || serverID == "local" {
		return unsupportedExecutor{}
	}
	return newSSHExecutor(app, serverID)
}

func NewLocalLifecycleExecutor() Executor {
	return localExecutor{}
}

type unsupportedExecutor struct{}

func (unsupportedExecutor) PrepareWorkspace(string, string) error {
	return fmt.Errorf("managed server is required for deployment execution")
}

func (unsupportedExecutor) DockerClient() (*docker.Client, error) {
	return nil, fmt.Errorf("managed server is required for deployment execution")
}

func (unsupportedExecutor) Name() string {
	return "unsupported"
}

func newSSHExecutor(app core.App, serverID string) sshExecutor {
	return sshExecutor{
		app:           app,
		serverID:      serverID,
		resolveConfig: defaultServerConfigResolver,
		sftpFactory:   defaultSFTPClientFactory,
	}
}

func resolveServerAccessConfig(app core.App, serverID string) (servers.AccessConfig, error) {
	return servers.ResolveConfigForUserID(app, serverID, "")
}

func terminalConfigFromServerAccess(cfg servers.AccessConfig) terminal.ConnectorConfig {
	return terminal.ConnectorConfig{
		Host:     cfg.Host,
		Port:     cfg.Port,
		User:     cfg.User,
		AuthType: terminal.CredAuthType(cfg.AuthType),
		Secret:   cfg.Secret,
		Shell:    cfg.Shell,
	}
}

func tunnelSSHPort(raw string) (int, error) {
	return servers.TunnelSSHPortFromServices(raw)
}
