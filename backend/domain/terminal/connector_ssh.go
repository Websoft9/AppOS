package terminal

import (
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"time"

	"context"

	cryptossh "golang.org/x/crypto/ssh"
)

const sshDialTimeout = 10 * time.Second

// ─── SSHConnector ─────────────────────────────────────────────────────────────

// SSHConnector establishes SSH PTY sessions to remote servers.
// Credentials are never stored; they are consumed once during Connect and
// held only for the duration of the session in-memory.
type SSHConnector struct{}

// Connect opens an SSH connection and returns a Session backed by a remote PTY.
func (c *SSHConnector) Connect(ctx context.Context, cfg ConnectorConfig) (Session, error) {
	authMethod, err := AuthMethodFromConfig(cfg)
	if err != nil {
		return nil, NewConnectError(ErrCatCredentialInvalid, fmt.Sprintf("credential config error for user %q", cfg.User), err)
	}

	clientCfg := &cryptossh.ClientConfig{
		User:    cfg.User,
		Auth:    []cryptossh.AuthMethod{authMethod},
		Timeout: sshDialTimeout,
	}

	hostKeyCallback, err := HostKeyCallback()
	if err != nil {
		return nil, NewConnectError(ErrCatCredentialInvalid, fmt.Sprintf("ssh host key verification setup failed for %q", cfg.Host), err)
	}
	clientCfg.HostKeyCallback = hostKeyCallback

	addr := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))
	type dialResult struct {
		client *cryptossh.Client
		err    error
	}
	ch := make(chan dialResult, 1)
	go func() {
		cl, err := cryptossh.Dial("tcp", addr, clientCfg)
		ch <- dialResult{cl, err}
	}()

	select {
	case <-ctx.Done():
		return nil, NewConnectError(ErrCatNetworkUnreachable, fmt.Sprintf("connection to %s timed out or cancelled", addr), ctx.Err())
	case r := <-ch:
		if r.err != nil {
			return nil, classifySSHDialError(r.err, addr, cfg.User)
		}
		return newSSHSession(r.client, cfg.Shell)
	}
}

// ─── sshSession ───────────────────────────────────────────────────────────────

type sshSession struct {
	client  *cryptossh.Client
	session *cryptossh.Session
	stdin   io.WriteCloser
	stdout  io.Reader
	hasPTY  bool
	mu      sync.Mutex
}

func newSSHSession(client *cryptossh.Client, shell string) (*sshSession, error) {
	sess, err := client.NewSession()
	if err != nil {
		client.Close()
		return nil, NewConnectError(ErrCatSessionFailed, "failed to open SSH session channel", err)
	}

	modes := cryptossh.TerminalModes{
		cryptossh.ECHO:          1,
		cryptossh.TTY_OP_ISPEED: 14400,
		cryptossh.TTY_OP_OSPEED: 14400,
	}
	hasPTY := true
	if err := requestPTYWithFallback(sess, 24, 80, modes); err != nil {
		hasPTY = false
	}

	stdin, err := sess.StdinPipe()
	if err != nil {
		sess.Close()
		client.Close()
		return nil, NewConnectError(ErrCatSessionFailed, "failed to open stdin pipe", err)
	}
	stdout, stderr, err := combinedSessionOutput(sess)
	if err != nil {
		sess.Close()
		client.Close()
		return nil, NewConnectError(ErrCatSessionFailed, "failed to open session output pipe", err)
	}
	_ = stderr

	if shell != "" {
		if err := sess.Start(shell); err != nil {
			if err2 := sess.Shell(); err2 != nil {
				sess.Close()
				client.Close()
				return nil, NewConnectError(ErrCatSessionFailed, fmt.Sprintf("shell %q failed and fallback login shell also failed", shell), err)
			}
		}
	} else {
		if err := sess.Shell(); err != nil {
			sess.Close()
			client.Close()
			return nil, NewConnectError(ErrCatSessionFailed, "login shell start failed", err)
		}
	}

	return &sshSession{
		client:  client,
		session: sess,
		stdin:   stdin,
		stdout:  stdout,
		hasPTY:  hasPTY,
	}, nil
}

func combinedSessionOutput(sess *cryptossh.Session) (io.Reader, io.Reader, error) {
	stdout, err := sess.StdoutPipe()
	if err != nil {
		return nil, nil, err
	}
	stderr, err := sess.StderrPipe()
	if err != nil {
		return nil, nil, err
	}

	pr, pw := io.Pipe()
	go func() {
		var wg sync.WaitGroup
		copyStream := func(r io.Reader) {
			defer wg.Done()
			_, _ = io.Copy(pw, r)
		}
		wg.Add(2)
		go copyStream(stdout)
		go copyStream(stderr)
		wg.Wait()
		_ = pw.Close()
	}()

	return pr, stderr, nil
}

func requestPTYWithFallback(sess *cryptossh.Session, rows, cols int, modes cryptossh.TerminalModes) error {
	termTypes := []string{"xterm-256color", "xterm", "vt100"}
	var lastErr error
	for _, termType := range termTypes {
		if err := sess.RequestPty(termType, rows, cols, modes); err == nil {
			return nil
		} else {
			lastErr = err
		}
	}
	return lastErr
}

func (s *sshSession) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stdin.Write(p)
}

func (s *sshSession) Read(p []byte) (int, error) { return s.stdout.Read(p) }

func (s *sshSession) Resize(rows, cols uint16) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.hasPTY {
		return nil
	}
	return s.session.WindowChange(int(rows), int(cols))
}

func (s *sshSession) Close() error {
	_ = s.stdin.Close()
	_ = s.session.Close()
	return s.client.Close()
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

// AuthMethodFromConfig builds the SSH auth method from a ConnectorConfig.
// Exported so operational tools (e.g. ExecuteSSHCommand in servers package) can reuse it.
func AuthMethodFromConfig(cfg ConnectorConfig) (cryptossh.AuthMethod, error) {
	switch cfg.AuthType {
	case AuthMethodPrivateKey, "key", "ssh_key":
		signer, err := cryptossh.ParsePrivateKey([]byte(cfg.Secret))
		if err != nil {
			return nil, fmt.Errorf("private key format invalid or passphrase required: %w", err)
		}
		return cryptossh.PublicKeys(signer), nil
	case AuthMethodPassword:
		return cryptossh.Password(cfg.Secret), nil
	default:
		return nil, fmt.Errorf("unsupported auth_type %q; expected password or private_key", cfg.AuthType)
	}
}

// ─── Error classification ─────────────────────────────────────────────────────

// classifySSHDialError maps a raw SSH dial error to a structured ConnectError.
func classifySSHDialError(err error, addr, user string) *ConnectError {
	s := err.Error()

	if strings.Contains(s, "unable to authenticate") ||
		strings.Contains(s, "no supported methods remain") ||
		strings.Contains(s, "permission denied") {
		return NewConnectError(ErrCatAuthFailed,
			fmt.Sprintf("authentication failed for user %q at %s — verify password or key", user, addr), err)
	}
	if strings.Contains(s, "handshake failed") && strings.Contains(s, "ssh:") {
		return NewConnectError(ErrCatAuthFailed,
			fmt.Sprintf("SSH handshake failed for user %q at %s — check credentials", user, addr), err)
	}
	if strings.Contains(s, "connection refused") {
		return NewConnectError(ErrCatConnectionRefused,
			fmt.Sprintf("connection refused by %s — SSH service may not be running or port is wrong", addr), err)
	}
	if strings.Contains(s, "i/o timeout") ||
		strings.Contains(s, "no route to host") ||
		strings.Contains(s, "network is unreachable") ||
		strings.Contains(s, "no such host") ||
		strings.Contains(s, "connection timed out") {
		return NewConnectError(ErrCatNetworkUnreachable,
			fmt.Sprintf("cannot reach %s — check host address, port, and network connectivity", addr), err)
	}
	if strings.Contains(s, "connection reset by peer") || strings.Contains(s, "EOF") {
		return NewConnectError(ErrCatServerDisconnected,
			fmt.Sprintf("server at %s disconnected during handshake — it may have rejected the client", addr), err)
	}
	return NewConnectError(ErrCatNetworkUnreachable, fmt.Sprintf("connection to %s failed", addr), err)
}

// ensure interface compliance
var _ Session = (*sshSession)(nil)
var _ Connector = (*SSHConnector)(nil)
