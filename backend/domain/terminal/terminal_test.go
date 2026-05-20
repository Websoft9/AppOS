package terminal

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// mockSession implements Session for testing the session registry.
type mockSession struct {
	closed bool
}

func (m *mockSession) Write(p []byte) (int, error) { return len(p), nil }
func (m *mockSession) Read(p []byte) (int, error)  { return 0, nil }
func (m *mockSession) Resize(_, _ uint16) error    { return nil }
func (m *mockSession) Close() error                { m.closed = true; return nil }

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

func TestListSummariesByUserFiltersAndSorts(t *testing.T) {
	registry.mu.Lock()
	registry.sessions = make(map[string]*registeredSession)
	registry.mu.Unlock()
	defer func() {
		registry.mu.Lock()
		registry.sessions = make(map[string]*registeredSession)
		registry.mu.Unlock()
	}()

	first := &mockSession{}
	second := &mockSession{}
	third := &mockSession{}

	RegisterDetailed("s-1", first, "user-a", "server", "srv-1", "ssh")
	RegisterDetailed("s-2", second, "user-b", "server", "srv-2", "ssh")
	RegisterDetailed("s-3", third, "user-a", "container", "ctr-1", "docker")
	Touch("s-3")

	summaries := ListSummariesByUser("user-a")
	if len(summaries) != 2 {
		t.Fatalf("expected 2 summaries, got %d", len(summaries))
	}
	if summaries[0].ID != "s-3" {
		t.Fatalf("expected most recent session first, got %s", summaries[0].ID)
	}
	if summaries[1].ID != "s-1" {
		t.Fatalf("expected older session second, got %s", summaries[1].ID)
	}
	if summaries[0].UserID != "user-a" || summaries[1].UserID != "user-a" {
		t.Fatal("expected summaries to be filtered by user")
	}
}

func TestUpdateWorkspaceUpdatesOwnedSession(t *testing.T) {
	registry.mu.Lock()
	registry.sessions = make(map[string]*registeredSession)
	registry.mu.Unlock()
	defer func() {
		registry.mu.Lock()
		registry.sessions = make(map[string]*registeredSession)
		registry.mu.Unlock()
	}()

	RegisterDetailed("s-1", &mockSession{}, "user-a", "server", "srv-1", "ssh")
	split := 0.35
	err := UpdateWorkspace("s-1", "user-a", TerminalWorkspaceSnapshot{
		ActiveServerID: "srv-1",
		SidePanel:      "files",
		FilePath:       "/var/log",
		LockedRoot:     "/var",
		SplitRatio:     &split,
	})
	if err != nil {
		t.Fatalf("unexpected update error: %v", err)
	}

	summaries := ListSummariesByUser("user-a")
	if len(summaries) != 1 {
		t.Fatalf("expected 1 summary, got %d", len(summaries))
	}
	if summaries[0].Workspace.FilePath != "/var/log" || summaries[0].Workspace.SidePanel != "files" {
		t.Fatalf("unexpected workspace snapshot: %+v", summaries[0].Workspace)
	}
	if summaries[0].Workspace.SplitRatio == nil || *summaries[0].Workspace.SplitRatio != split {
		t.Fatalf("unexpected split ratio: %+v", summaries[0].Workspace.SplitRatio)
	}
}

func TestCloseOwnedRemovesOwnedSession(t *testing.T) {
	registry.mu.Lock()
	registry.sessions = make(map[string]*registeredSession)
	registry.mu.Unlock()
	defer func() {
		registry.mu.Lock()
		registry.sessions = make(map[string]*registeredSession)
		registry.mu.Unlock()
	}()

	sess := &mockSession{}
	RegisterDetailed("s-close", sess, "user-a", "server", "srv-1", "ssh")

	if err := CloseOwned("s-close", "user-a"); err != nil {
		t.Fatalf("unexpected close error: %v", err)
	}
	if !sess.closed {
		t.Fatal("expected session to be closed")
	}
	if summaries := ListSummariesByUser("user-a"); len(summaries) != 0 {
		t.Fatalf("expected registry to be empty, got %d summary items", len(summaries))
	}
}

func TestAppendReplayBufferRetainsRecentOutput(t *testing.T) {
	prefix := make([]byte, sessionReplayBufferLimit/2)
	for index := range prefix {
		prefix[index] = 'a'
	}
	suffix := make([]byte, sessionReplayBufferLimit)
	for index := range suffix {
		suffix[index] = 'b'
	}

	buffer := appendReplayBuffer(nil, prefix)
	buffer = appendReplayBuffer(buffer, suffix)

	if len(buffer) != sessionReplayBufferLimit {
		t.Fatalf("expected replay buffer len %d, got %d", sessionReplayBufferLimit, len(buffer))
	}
	if buffer[0] != 'b' || buffer[len(buffer)-1] != 'b' {
		t.Fatalf("expected buffer to retain newest payload tail, got first=%q last=%q", buffer[0], buffer[len(buffer)-1])
	}
}

func TestAttachResumableReplaysBufferedOutput(t *testing.T) {
	registry.mu.Lock()
	registry.sessions = make(map[string]*registeredSession)
	registry.mu.Unlock()
	defer func() {
		registry.mu.Lock()
		registry.sessions = make(map[string]*registeredSession)
		registry.mu.Unlock()
	}()

	upgrader := websocket.Upgrader{}
	serverConnCh := make(chan *websocket.Conn, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade failed: %v", err)
			return
		}
		serverConnCh <- conn
	}))
	defer server.Close()

	wsURL := "ws" + server.URL[len("http"):]
	clientConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	defer clientConn.Close()

	serverConn := <-serverConnCh
	defer serverConn.Close()

	registry.mu.Lock()
	registry.sessions["replay-1"] = &registeredSession{
		id:           "replay-1",
		session:      &mockSession{},
		userID:       "user-a",
		resourceType: "server",
		resourceID:   "srv-1",
		sessionType:  "ssh",
		startedAt:    time.Now(),
		lastMsg:      time.Now(),
		state:        SessionStateDetached,
		outputBuffer: []byte("prompt$ ls\r\nfile.txt\r\nprompt$ "),
	}
	registry.mu.Unlock()

	if err := AttachResumable("replay-1", "user-a", "server", "srv-1", "ssh", serverConn); err != nil {
		t.Fatalf("attach failed: %v", err)
	}

	if err := clientConn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatalf("set deadline failed: %v", err)
	}
	msgType, payload, err := clientConn.ReadMessage()
	if err != nil {
		t.Fatalf("read failed: %v", err)
	}
	if msgType != websocket.BinaryMessage {
		t.Fatalf("expected binary message, got %d", msgType)
	}
	if string(payload) != "prompt$ ls\r\nfile.txt\r\nprompt$ " {
		t.Fatalf("unexpected replay payload: %q", string(payload))
	}
}

func TestIdleMonitorStartStopIdempotent(t *testing.T) {
	StopIdleMonitor()
	StartIdleMonitor()
	StartIdleMonitor()
	StopIdleMonitor()
	StopIdleMonitor()
}

func TestStopIdleMonitorClosesTrackedSessions(t *testing.T) {
	StopIdleMonitor()
	StartIdleMonitor()

	id := "test-stop-closes"
	sess := &mockSession{}
	Register(id, sess)

	StopIdleMonitor()

	if !sess.closed {
		t.Fatal("expected tracked session to be closed on StopIdleMonitor")
	}

	registry.mu.Lock()
	_, ok := registry.sessions[id]
	registry.mu.Unlock()
	if ok {
		t.Fatal("expected registry to be emptied on StopIdleMonitor")
	}
}

func TestAuthMethodFromConfig_Password(t *testing.T) {
	cfg := ConnectorConfig{
		AuthType: "password",
		Secret:   "secret123",
	}
	method, err := AuthMethodFromConfig(cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if method == nil {
		t.Fatal("expected non-nil auth method")
	}
}

func TestAuthMethodFromConfig_InvalidType(t *testing.T) {
	cfg := ConnectorConfig{AuthType: "unknown"}
	_, err := AuthMethodFromConfig(cfg)
	if err == nil {
		t.Fatal("expected error for unknown auth type")
	}
}

func TestAuthMethodFromConfig_PrivateKey_Invalid(t *testing.T) {
	cfg := ConnectorConfig{
		AuthType: "private_key",
		Secret:   "not-a-valid-key",
	}
	_, err := AuthMethodFromConfig(cfg)
	if err == nil {
		t.Fatal("expected error for invalid private key")
	}
}

func TestAuthMethodFromConfig_SSHKeyAlias_Invalid(t *testing.T) {
	cfg := ConnectorConfig{
		AuthType: "ssh_key",
		Secret:   "not-a-valid-key",
	}
	_, err := AuthMethodFromConfig(cfg)
	if err == nil {
		t.Fatal("expected error for invalid ssh_key alias")
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

// ─── ConnectError & classifySSHDialError Tests ───────────────────────────────

func TestConnectErrorFormat(t *testing.T) {
	cause := fmt.Errorf("root cause")
	ce := NewConnectError(ErrCatAuthFailed, "bad password", cause)
	got := ce.Error()
	want := "auth_failed: bad password: root cause"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	if !errors.Is(ce, cause) {
		t.Fatal("Unwrap should return cause")
	}
}

func TestConnectErrorFormatNoCause(t *testing.T) {
	ce := NewConnectError(ErrCatSessionFailed, "pty refused", nil)
	got := ce.Error()
	want := "session_failed: pty refused"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestConnectErrorAs(t *testing.T) {
	ce := NewConnectError(ErrCatAuthFailed, "test", nil)
	var wrapped error = fmt.Errorf("wrap: %w", ce)
	var target *ConnectError
	if !errors.As(wrapped, &target) {
		t.Fatal("errors.As should find ConnectError")
	}
	if target.Category != ErrCatAuthFailed {
		t.Fatalf("category: got %q, want %q", target.Category, ErrCatAuthFailed)
	}
}

func TestClassifySSHDialError(t *testing.T) {
	tests := []struct {
		name    string
		errMsg  string
		wantCat ConnectErrorCategory
	}{
		{"auth unable to authenticate", "ssh: unable to authenticate, attempted methods [none password], no supported methods remain", ErrCatAuthFailed},
		{"auth permission denied", "ssh: permission denied (publickey,password)", ErrCatAuthFailed},
		{"auth handshake failed", "ssh: handshake failed: ssh: unable to authenticate", ErrCatAuthFailed},
		{"connection refused", "dial tcp 1.2.3.4:22: connect: connection refused", ErrCatConnectionRefused},
		{"timeout", "dial tcp 1.2.3.4:22: i/o timeout", ErrCatNetworkUnreachable},
		{"no route", "dial tcp 1.2.3.4:22: connect: no route to host", ErrCatNetworkUnreachable},
		{"no such host", "dial tcp: lookup bad.host: no such host", ErrCatNetworkUnreachable},
		{"reset by peer", "read tcp: connection reset by peer", ErrCatServerDisconnected},
		{"eof during handshake", "ssh: EOF", ErrCatServerDisconnected},
		{"unknown error", "something unexpected", ErrCatNetworkUnreachable},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ce := classifySSHDialError(fmt.Errorf("%s", tt.errMsg), "1.2.3.4:22", "root")
			if ce.Category != tt.wantCat {
				t.Errorf("category: got %q, want %q (msg=%q)", ce.Category, tt.wantCat, ce.Message)
			}
			if ce.Cause == nil {
				t.Error("cause should be non-nil")
			}
		})
	}
}

func TestSSHConnectorReturnsConnectError(t *testing.T) {
	// Connect to a port that doesn't exist → should return classified ConnectError
	conn := &SSHConnector{}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	_, err := conn.Connect(ctx, ConnectorConfig{
		Host:     "127.0.0.1",
		Port:     1, // privileged port, no SSH server
		User:     "test",
		AuthType: "password",
		Secret:   "test",
	})
	if err == nil {
		t.Fatal("expected error")
	}
	var ce *ConnectError
	if !errors.As(err, &ce) {
		t.Fatalf("expected ConnectError, got %T: %v", err, err)
	}
	// Should be connection_refused or network_unreachable depending on OS
	validCats := map[ConnectErrorCategory]bool{
		ErrCatConnectionRefused:  true,
		ErrCatNetworkUnreachable: true,
		ErrCatServerDisconnected: true,
	}
	if !validCats[ce.Category] {
		t.Fatalf("unexpected category %q for connect to closed port", ce.Category)
	}
}

func TestSSHConnectorCredentialInvalid(t *testing.T) {
	conn := &SSHConnector{}
	_, err := conn.Connect(context.Background(), ConnectorConfig{
		Host:     "127.0.0.1",
		Port:     22,
		User:     "test",
		AuthType: "magic_auth",
		Secret:   "test",
	})
	if err == nil {
		t.Fatal("expected error")
	}
	var ce *ConnectError
	if !errors.As(err, &ce) {
		t.Fatalf("expected ConnectError, got %T: %v", err, err)
	}
	if ce.Category != ErrCatCredentialInvalid {
		t.Fatalf("category: got %q, want %q", ce.Category, ErrCatCredentialInvalid)
	}
}
