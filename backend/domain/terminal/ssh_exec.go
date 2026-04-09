package terminal

import (
	"context"
	"fmt"
	"net"
	"strings"
	"time"

	cryptossh "golang.org/x/crypto/ssh"
)

// ShellQuote wraps a value in single quotes, escaping any embedded single quotes.
func ShellQuote(value string) string {
	if value == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

// ExecuteSSHCommand runs a one-shot command on a remote server via SSH and
// returns the combined stdout+stderr output. If timeout <= 0, a 20-second
// default is applied.
func ExecuteSSHCommand(ctx context.Context, cfg ConnectorConfig, command string, timeout time.Duration) (string, error) {
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	authMethod, err := AuthMethodFromConfig(cfg)
	if err != nil {
		return "", err
	}
	hostKeyCallback, err := HostKeyCallback()
	if err != nil {
		return "", err
	}

	clientCfg := &cryptossh.ClientConfig{
		User:            cfg.User,
		Auth:            []cryptossh.AuthMethod{authMethod},
		HostKeyCallback: hostKeyCallback,
		Timeout:         10 * time.Second,
	}

	addr := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))
	type dialResult struct {
		client *cryptossh.Client
		err    error
	}
	dialCh := make(chan dialResult, 1)
	go func() {
		client, dialErr := cryptossh.Dial("tcp", addr, clientCfg)
		dialCh <- dialResult{client: client, err: dialErr}
	}()

	var client *cryptossh.Client
	select {
	case <-cmdCtx.Done():
		return "", cmdCtx.Err()
	case result := <-dialCh:
		if result.err != nil {
			return "", fmt.Errorf("ssh dial failed: %w", result.err)
		}
		client = result.client
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("ssh new session failed: %w", err)
	}
	defer session.Close()

	type commandResult struct {
		output []byte
		err    error
	}
	cmdCh := make(chan commandResult, 1)
	go func() {
		out, cmdErr := session.CombinedOutput(command)
		cmdCh <- commandResult{output: out, err: cmdErr}
	}()

	select {
	case <-cmdCtx.Done():
		_ = session.Close()
		return "", cmdCtx.Err()
	case result := <-cmdCh:
		output := strings.TrimSpace(string(result.output))
		if result.err != nil {
			if output == "" {
				return output, result.err
			}
			return output, fmt.Errorf("%w: %s", result.err, output)
		}
		return output, nil
	}
}
