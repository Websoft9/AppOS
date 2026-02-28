package terminal

import (
	"context"
	"fmt"
	"net"
	"testing"
	"time"
)

// mockSession implements Session for testing the session registry.
type mockSession struct {
	closed bool
}

func (m *mockSession) Write(p []byte) (int, error) { return len(p), nil }
func (m *mockSession) Read(p []byte) (int, error)  { return 0, nil }
func (m *mockSession) Resize(_, _ uint16) error     { return nil }
func (m *mockSession) Close() error                  { m.closed = true; return nil }

func TestSessionRegistryTouchPreventsTimeout(t *testing.T) {
	sess := &mockSession{}
	id := "test-touch"
	Register(id, sess)
	defer Unregister(id)

	// Touch should update lastMsg
	time.Sleep(10 * time.Millisecond)
	Touch(id)

	registry.mu.Lock()
	rs, ok := registry.sessions[id]
	registry.mu.Unlock()

	if !ok {
		t.Fatal("session should still be registered after Touch")
	}
	if time.Since(rs.lastMsg) > time.Second {
		t.Fatal("lastMsg should have been updated by Touch")
	}
}

func TestSessionRegistryUnregister(t *testing.T) {
	sess := &mockSession{}
	id := "test-unregister"
	Register(id, sess)
	Unregister(id)

	registry.mu.Lock()
	_, ok := registry.sessions[id]
	registry.mu.Unlock()

	if ok {
		t.Fatal("session should have been removed after Unregister")
	}
}

func TestAuthMethodFromConfig_Password(t *testing.T) {
	cfg := ConnectorConfig{
		AuthType: "password",
		Secret:   "secret123",
	}
	method, err := authMethodFromConfig(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if method == nil {
		t.Fatal("expected non-nil auth method")
	}
}

func TestAuthMethodFromConfig_InvalidType(t *testing.T) {
	cfg := ConnectorConfig{AuthType: "unknown"}
	_, err := authMethodFromConfig(cfg)
	if err == nil {
		t.Fatal("expected error for unknown auth type")
	}
}

func TestAuthMethodFromConfig_PrivateKey_Invalid(t *testing.T) {
	cfg := ConnectorConfig{
		AuthType: "private_key",
		Secret:   "not-a-valid-key",
	}
	_, err := authMethodFromConfig(cfg)
	if err == nil {
		t.Fatal("expected error for invalid private key")
	}
}

func TestSFTPMaxUploadConstant(t *testing.T) {
	expected := int64(50 << 20)
	if sftpMaxUploadBytes != expected {
		t.Fatalf("sftpMaxUploadBytes: got %d, want %d", sftpMaxUploadBytes, expected)
	}
}

func TestConnectorConfigFields(t *testing.T) {
	cfg := ConnectorConfig{
		Host:     "example.com",
		Port:     22,
		User:     "root",
		AuthType: "password",
		Secret:   "pass",
		Shell:    "bash",
	}
	if cfg.Host != "example.com" {
		t.Fatal("host mismatch")
	}
	if cfg.Port != 22 {
		t.Fatal("port mismatch")
	}
	if cfg.Shell != "bash" {
		t.Fatal("shell mismatch")
	}
}

func TestDockerExecDefaultShell(t *testing.T) {
	if defaultDockerShell != "/bin/sh" {
		t.Fatalf("defaultDockerShell: got %q, want /bin/sh", defaultDockerShell)
	}
}

func TestDockerExecDefaultSocket(t *testing.T) {
	if defaultDockerSocket != "/var/run/docker.sock" {
		t.Fatalf("defaultDockerSocket: got %q, want /var/run/docker.sock", defaultDockerSocket)
	}
}

func TestDockerExecConnectorImplementsInterface(t *testing.T) {
	// Compile-time check that DockerExecConnector implements Connector
	var _ Connector = &DockerExecConnector{}
}

func TestDockerShellAutoFallbackOrder(t *testing.T) {
	origCreate := dockerCreateExecFn
	origStart := dockerStartExecFn
	defer func() {
		dockerCreateExecFn = origCreate
		dockerStartExecFn = origStart
	}()

	attempts := make([]string, 0)
	dockerCreateExecFn = func(_ string, shell string) (string, error) {
		attempts = append(attempts, shell)
		if shell == "/bin/sh" {
			return "ok", nil
		}
		return "", fmt.Errorf("unsupported shell")
	}
	dockerStartExecFn = func(execID string) (net.Conn, error) {
		return nil, fmt.Errorf("stop after shell selection: %s", execID)
	}

	conn := &DockerExecConnector{}
	_, _ = conn.Connect(context.Background(), ConnectorConfig{Host: "container-1"})

	if len(attempts) < 2 {
		t.Fatalf("expected multiple shell attempts, got %v", attempts)
	}
	if attempts[0] != "/bin/bash" || attempts[1] != "/bin/sh" {
		t.Fatalf("unexpected fallback order: %v", attempts)
	}
}
