package docker

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// SSHConfig holds connection parameters for an SSH executor.
type SSHConfig struct {
	Host     string
	Port     int
	User     string
	AuthType string // "password" or "key"
	Secret   string // decrypted: password string or PEM private key
}

// SSHExecutor runs commands on a remote host over SSH.
type SSHExecutor struct {
	cfg SSHConfig
}

// NewSSHExecutor creates a new SSH executor with the given config.
func NewSSHExecutor(cfg SSHConfig) *SSHExecutor {
	if cfg.Port == 0 {
		cfg.Port = 22
	}
	return &SSHExecutor{cfg: cfg}
}

func (e *SSHExecutor) clientConfig() (*ssh.ClientConfig, error) {
	var authMethods []ssh.AuthMethod

	switch e.cfg.AuthType {
	case "key", "ssh_key":
		signer, err := ssh.ParsePrivateKey([]byte(e.cfg.Secret))
		if err != nil {
			return nil, fmt.Errorf("parse private key: %w", err)
		}
		authMethods = []ssh.AuthMethod{ssh.PublicKeys(signer)}
	default:
		// password / username_password / any fallback
		authMethods = []ssh.AuthMethod{ssh.Password(e.cfg.Secret)}
	}

	return &ssh.ClientConfig{
		User:            e.cfg.User,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), //nolint:gosec // intentional for now
		Timeout:         10 * time.Second,
	}, nil
}

func (e *SSHExecutor) dial() (*ssh.Client, error) {
	cfg, err := e.clientConfig()
	if err != nil {
		return nil, err
	}
	addr := fmt.Sprintf("%s:%d", e.cfg.Host, e.cfg.Port)
	return ssh.Dial("tcp", addr, cfg)
}

// Run executes a command on the remote host and returns buffered stdout.
func (e *SSHExecutor) Run(ctx context.Context, command string, args ...string) (string, error) {
	client, err := e.dial()
	if err != nil {
		return "", fmt.Errorf("ssh connect to %s: %w", e.cfg.Host, err)
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("ssh session: %w", err)
	}
	defer session.Close()

	cmd := strings.Join(append([]string{command}, args...), " ")
	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr

	// Respect context cancellation via a goroutine
	done := make(chan error, 1)
	go func() { done <- session.Run(cmd) }()

	select {
	case <-ctx.Done():
		_ = client.Close()
		return "", ctx.Err()
	case err = <-done:
		if err != nil {
			return "", fmt.Errorf("%s: %w", strings.TrimSpace(stderr.String()), err)
		}
	}

	return strings.TrimSpace(stdout.String()), nil
}

// RunStream executes a command and returns a streaming reader for stdout.
func (e *SSHExecutor) RunStream(ctx context.Context, command string, args ...string) (io.ReadCloser, error) {
	client, err := e.dial()
	if err != nil {
		return nil, fmt.Errorf("ssh connect to %s: %w", e.cfg.Host, err)
	}

	session, err := client.NewSession()
	if err != nil {
		client.Close()
		return nil, fmt.Errorf("ssh session: %w", err)
	}

	cmd := strings.Join(append([]string{command}, args...), " ")
	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		client.Close()
		return nil, err
	}

	if err := session.Start(cmd); err != nil {
		session.Close()
		client.Close()
		return nil, err
	}

	// Watch context: if cancelled, forcefully close the connection so Read() unblocks.
	watchCtx, cancel := context.WithCancel(ctx)
	rc := &sshReadCloser{
		ReadCloser: io.NopCloser(stdout),
		session:    session,
		client:     client,
		cancel:     cancel,
	}
	go func() {
		<-watchCtx.Done()
		_ = client.Close()
	}()
	return rc, nil
}

// Ping tests SSH connectivity by running a simple echo command.
func (e *SSHExecutor) Ping(ctx context.Context) error {
	_, err := e.Run(ctx, "echo", "ok")
	return err
}

// Host returns the SSH host label.
func (e *SSHExecutor) Host() string {
	return e.cfg.Host
}

// sshReadCloser wraps an SSH stdout pipe and closes session+client when done.
type sshReadCloser struct {
	io.ReadCloser
	session *ssh.Session
	client  *ssh.Client
	cancel  context.CancelFunc // stops the ctx-watcher goroutine
}

func (r *sshReadCloser) Close() error {
	r.cancel() // stop context-watcher goroutine first
	err := r.ReadCloser.Close()
	_ = r.session.Close()
	_ = r.client.Close()
	return err
}
