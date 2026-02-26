package terminal

import (
	"context"
	"fmt"
	"io"
	"net"
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
	authMethod, err := authMethodFromConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("ssh: auth config: %w", err)
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
		return nil, ctx.Err()
	case r := <-ch:
		if r.err != nil {
			return nil, fmt.Errorf("ssh: dial %s: %w", addr, r.err)
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
		return nil, fmt.Errorf("ssh: new session: %w", err)
	}

	modes := cryptossh.TerminalModes{
		cryptossh.ECHO:          1,
		cryptossh.TTY_OP_ISPEED: 14400,
		cryptossh.TTY_OP_OSPEED: 14400,
	}
	if err := sess.RequestPty("xterm-256color", 24, 80, modes); err != nil {
		sess.Close()
		client.Close()
		return nil, fmt.Errorf("ssh: request pty: %w", err)
	}

	stdin, err := sess.StdinPipe()
	if err != nil {
		sess.Close()
		client.Close()
		return nil, fmt.Errorf("ssh: stdin pipe: %w", err)
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		sess.Close()
		client.Close()
		return nil, fmt.Errorf("ssh: stdout pipe: %w", err)
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
				return nil, fmt.Errorf("ssh: start shell %q (fallback also failed: %v): %w", shell, err2, err)
			}
		}
	} else {
		if err := sess.Shell(); err != nil {
			sess.Close()
			client.Close()
			return nil, fmt.Errorf("ssh: start login shell: %w", err)
		}
	}

	return &sshSession{
		client:  client,
		session: sess,
		stdin:   stdin,
		stdout:  stdout,
	}, nil
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

// authMethodFromConfig builds the SSH auth method from ConnectorConfig.
func authMethodFromConfig(cfg ConnectorConfig) (cryptossh.AuthMethod, error) {
	switch cfg.AuthType {
	case "private_key":
		signer, err := cryptossh.ParsePrivateKey([]byte(cfg.Secret))
		if err != nil {
			return nil, fmt.Errorf("parse private key: %w", err)
		}
		return cryptossh.PublicKeys(signer), nil
	case "password":
		return cryptossh.Password(cfg.Secret), nil
	default:
		return nil, fmt.Errorf("unsupported auth_type: %q", cfg.AuthType)
	}
}

// ensure interface compliance
var _ Session = (*sshSession)(nil)
var _ Connector = (*SSHConnector)(nil)
