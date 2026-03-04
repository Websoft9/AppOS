package servers

import (
	"context"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"time"

	cryptossh "golang.org/x/crypto/ssh"
)

const sshDialTimeout = 10 * time.Second

// SSHConnector establishes SSH sessions to remote servers.
// Credentials are never stored; they are consumed once during Connect and
// held only for the duration of the session in-memory.
type SSHConnector struct{}

// Connect opens an SSH connection and returns a Session backed by a remote PTY.
// The returned Session must be closed by the caller.
func (c *SSHConnector) Connect(ctx context.Context, cfg ConnectorConfig) (Session, error) {
	authMethod, err := AuthMethodFromConfig(cfg)
	if err != nil {
		return nil, NewConnectError(ErrCatCredentialInvalid, fmt.Sprintf("credential config error for user %q", cfg.User), err)
	}

	clientCfg := &cryptossh.ClientConfig{
		User:            cfg.User,
		Auth:            []cryptossh.AuthMethod{authMethod},
		HostKeyCallback: cryptossh.InsecureIgnoreHostKey(), //nolint:gosec // single-server, zero-trust via audit
		Timeout:         sshDialTimeout,
	}

	addr := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))
	// Respect context cancellation during dial
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
			return nil, classifyDialError(r.err, addr, cfg.User)
		}
		return newSSHSession(r.client, cfg.Shell)
	}
}

// sshSession wraps an SSH client + session + remote PTY.
type sshSession struct {
	client  *cryptossh.Client
	session *cryptossh.Session
	stdin   io.WriteCloser
	stdout  io.Reader
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
	ptyErr := requestPTYWithFallback(sess, 24, 80, modes)
	if ptyErr != nil {
		sess.Close()
		client.Close()
		return nil, NewConnectError(ErrCatSessionFailed, "terminal (PTY) allocation refused by server", ptyErr)
	}

	stdin, err := sess.StdinPipe()
	if err != nil {
		sess.Close()
		client.Close()
		return nil, NewConnectError(ErrCatSessionFailed, "failed to open stdin pipe", err)
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		sess.Close()
		client.Close()
		return nil, NewConnectError(ErrCatSessionFailed, "failed to open stdout pipe", err)
	}

	// Use the configured shell override, or ask the server for the user's default
	// login shell. sess.Shell() is correct here — sess.Start("$SHELL") would send
	// the literal string "$SHELL" to the remote exec, which most SSH servers do not
	// expand as a variable.
	if shell != "" {
		if err := sess.Start(shell); err != nil {
			// Fallback to login shell if the custom shell path fails.
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
	}, nil
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

func (s *sshSession) Read(p []byte) (int, error) {
	return s.stdout.Read(p)
}

func (s *sshSession) Resize(rows, cols uint16) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.session.WindowChange(int(rows), int(cols))
}

func (s *sshSession) Close() error {
	_ = s.stdin.Close()
	_ = s.session.Close()
	return s.client.Close()
}

// AuthMethodFromConfig builds the SSH auth method from ConnectorConfig.
// Exported so routes (e.g. one-shot SSH commands in server_ops) can reuse it.
func AuthMethodFromConfig(cfg ConnectorConfig) (cryptossh.AuthMethod, error) {
	switch cfg.AuthType {
	case "private_key", "key", "ssh_key":
		signer, err := cryptossh.ParsePrivateKey([]byte(cfg.Secret))
		if err != nil {
			return nil, fmt.Errorf("private key format invalid or passphrase required: %w", err)
		}
		return cryptossh.PublicKeys(signer), nil
	case "password":
		return cryptossh.Password(cfg.Secret), nil
	default:
		return nil, fmt.Errorf("unsupported auth_type %q; expected password or private_key", cfg.AuthType)
	}
}

// classifyDialError inspects an SSH dial error and returns a ConnectError with
// the appropriate category so callers can display actionable feedback.
func classifyDialError(err error, addr, user string) *ConnectError {
	s := err.Error()

	// ── Authentication failures ──
	if strings.Contains(s, "unable to authenticate") ||
		strings.Contains(s, "no supported methods remain") ||
		strings.Contains(s, "permission denied") {
		return NewConnectError(ErrCatAuthFailed,
			fmt.Sprintf("authentication failed for user %q at %s — verify password or key", user, addr), err)
	}
	if strings.Contains(s, "handshake failed") {
		// handshake failures that aren't auth are likely protocol mismatches
		if strings.Contains(s, "ssh:") {
			return NewConnectError(ErrCatAuthFailed,
				fmt.Sprintf("SSH handshake failed for user %q at %s — check credentials", user, addr), err)
		}
	}

	// ── Connection refused ──
	if strings.Contains(s, "connection refused") {
		return NewConnectError(ErrCatConnectionRefused,
			fmt.Sprintf("connection refused by %s — SSH service may not be running or port is wrong", addr), err)
	}

	// ── Network unreachable / timeout ──
	if strings.Contains(s, "i/o timeout") ||
		strings.Contains(s, "no route to host") ||
		strings.Contains(s, "network is unreachable") ||
		strings.Contains(s, "no such host") ||
		strings.Contains(s, "connection timed out") {
		return NewConnectError(ErrCatNetworkUnreachable,
			fmt.Sprintf("cannot reach %s — check host address, port, and network connectivity", addr), err)
	}

	// ── Server disconnected (RST/EOF during handshake) ──
	if strings.Contains(s, "connection reset by peer") ||
		strings.Contains(s, "EOF") {
		return NewConnectError(ErrCatServerDisconnected,
			fmt.Sprintf("server at %s disconnected during handshake — it may have rejected the client", addr), err)
	}

	// ── Fallback ──
	return NewConnectError(ErrCatNetworkUnreachable,
		fmt.Sprintf("connection to %s failed", addr), err)
}

// ensure interface compliance
var _ Session = (*sshSession)(nil)
var _ Connector = (*SSHConnector)(nil)
