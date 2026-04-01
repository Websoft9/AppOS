package runtime

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/servers"
)

type mockSFTPClient struct {
	mkdirCalls []string
	writeCalls []struct {
		path    string
		content string
	}
}

func (m *mockSFTPClient) MkdirAll(path string) error {
	m.mkdirCalls = append(m.mkdirCalls, path)
	return nil
}

func (m *mockSFTPClient) WriteFile(path string, content string) error {
	m.writeCalls = append(m.writeCalls, struct {
		path    string
		content string
	}{path: path, content: content})
	return nil
}

func (m *mockSFTPClient) Close() error {
	return nil
}

func TestNewDeploymentExecutor(t *testing.T) {
	tests := []struct {
		name     string
		serverID string
		wantName string
	}{
		{name: "empty server id", serverID: "", wantName: "local"},
		{name: "explicit local", serverID: "local", wantName: "local"},
		{name: "remote id", serverID: "srv-1", wantName: "ssh"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			exec := NewDeploymentExecutor(nil, tc.serverID)
			if got := exec.Name(); got != tc.wantName {
				t.Fatalf("NewDeploymentExecutor(%q).Name() = %q, want %q", tc.serverID, got, tc.wantName)
			}
		})
	}
}

func TestLocalExecutorPrepareWorkspace(t *testing.T) {
	tmpDir := t.TempDir()
	projectDir := filepath.Join(tmpDir, "project")
	compose := "services:\n  web:\n    image: nginx:alpine\n"

	exec := localExecutor{}
	if err := exec.PrepareWorkspace(projectDir, compose); err != nil {
		t.Fatalf("PrepareWorkspace returned error: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(projectDir, "docker-compose.yml"))
	if err != nil {
		t.Fatalf("failed to read docker-compose.yml: %v", err)
	}
	if got := string(data); got != compose {
		t.Fatalf("unexpected compose content: got %q want %q", got, compose)
	}
}

func TestTunnelSSHPort(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    int
		wantErr bool
	}{
		{name: "valid ssh service", raw: `[{"service_name":"ssh","tunnel_port":2222}]`, want: 2222},
		{name: "missing ssh service", raw: `[{"service_name":"http","tunnel_port":8080}]`, wantErr: true},
		{name: "invalid json", raw: `not-json`, wantErr: true},
		{name: "empty payload", raw: "", wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := tunnelSSHPort(tc.raw)
			if tc.wantErr && err == nil {
				t.Fatal("expected error but got nil")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("tunnelSSHPort() = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestSSHExecutorPrepareWorkspaceUsesInjectedDependencies(t *testing.T) {
	mockClient := &mockSFTPClient{}
	resolverCalled := false
	factoryCalled := false

	exec := sshExecutor{
		app:      nil,
		serverID: "srv-1",
		resolveConfig: func(app core.App, serverID string) (servers.ConnectorConfig, error) {
			resolverCalled = true
			if serverID != "srv-1" {
				t.Fatalf("unexpected serverID: %s", serverID)
			}
			return servers.ConnectorConfig{Host: "example.com", Port: 22, User: "root"}, nil
		},
		sftpFactory: func(ctx context.Context, cfg servers.ConnectorConfig) (SFTPClient, error) {
			factoryCalled = true
			if cfg.Host != "example.com" {
				t.Fatalf("unexpected host in cfg: %s", cfg.Host)
			}
			return mockClient, nil
		},
	}

	projectDir := "/tmp/project"
	compose := "services:\n  web:\n    image: nginx:alpine\n"
	if err := exec.PrepareWorkspace(projectDir, compose); err != nil {
		t.Fatalf("PrepareWorkspace returned error: %v", err)
	}
	if !resolverCalled {
		t.Fatal("expected resolver to be called")
	}
	if !factoryCalled {
		t.Fatal("expected sftp factory to be called")
	}
	if len(mockClient.mkdirCalls) != 1 || mockClient.mkdirCalls[0] != projectDir {
		t.Fatalf("unexpected mkdir calls: %+v", mockClient.mkdirCalls)
	}
	if len(mockClient.writeCalls) != 1 {
		t.Fatalf("unexpected write calls count: %d", len(mockClient.writeCalls))
	}
	if mockClient.writeCalls[0].path != filepath.Join(projectDir, "docker-compose.yml") {
		t.Fatalf("unexpected write path: %s", mockClient.writeCalls[0].path)
	}
	if mockClient.writeCalls[0].content != compose {
		t.Fatalf("unexpected compose content: %q", mockClient.writeCalls[0].content)
	}
}

func TestSSHExecutorPrepareWorkspaceResolverError(t *testing.T) {
	wantErr := errors.New("resolver failed")
	exec := sshExecutor{
		app:      nil,
		serverID: "srv-1",
		resolveConfig: func(app core.App, serverID string) (servers.ConnectorConfig, error) {
			return servers.ConnectorConfig{}, wantErr
		},
	}

	err := exec.PrepareWorkspace("/tmp/project", "services: {}")
	if !errors.Is(err, wantErr) {
		t.Fatalf("expected resolver error, got: %v", err)
	}
}