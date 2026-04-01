package docker

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
	"strings"
)

// LocalExecutor runs commands via os/exec on the local host.
type LocalExecutor struct {
	// DockerHost is the DOCKER_HOST env value (e.g. "unix:///var/run/docker.sock").
	DockerHost string

	// SudoEnabled wraps every command with `sudo` when the process is not root.
	SudoEnabled bool

	// SudoPassword is the password for `sudo -S`. Empty means passwordless sudo (NOPASSWD).
	SudoPassword string
}

// NewLocalExecutor creates a LocalExecutor with the given Docker host.
func NewLocalExecutor(dockerHost string) *LocalExecutor {
	if dockerHost == "" {
		dockerHost = "unix:///var/run/docker.sock"
	}
	return &LocalExecutor{DockerHost: dockerHost}
}

// buildCmd constructs the exec.Cmd, wrapping with sudo when SudoEnabled is set.
func (e *LocalExecutor) buildCmd(ctx context.Context, command string, args []string) *exec.Cmd {
	if e.SudoEnabled {
		allArgs := append([]string{command}, args...)
		if e.SudoPassword != "" {
			// -S: read password from stdin; -p '': suppress prompt text
			return exec.CommandContext(ctx, "sudo", append([]string{"-S", "-p", "", "--"}, allArgs...)...)
		}
		// Passwordless sudo (-n: non-interactive, fail if password needed)
		return exec.CommandContext(ctx, "sudo", append([]string{"-n", "--"}, allArgs...)...)
	}
	return exec.CommandContext(ctx, command, args...)
}

// Run executes a command and returns buffered stdout.
func (e *LocalExecutor) Run(ctx context.Context, command string, args ...string) (string, error) {
	cmd := e.buildCmd(ctx, command, args)
	cmd.Env = append(cmd.Environ(), "DOCKER_HOST="+e.DockerHost)

	if e.SudoEnabled && e.SudoPassword != "" {
		cmd.Stdin = strings.NewReader(e.SudoPassword + "\n")
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%s: %w", strings.TrimSpace(stderr.String()), err)
	}
	return strings.TrimSpace(stdout.String()), nil
}

// RunStream executes a command and returns a streaming reader for stdout.
func (e *LocalExecutor) RunStream(ctx context.Context, command string, args ...string) (io.ReadCloser, error) {
	cmd := e.buildCmd(ctx, command, args)
	cmd.Env = append(cmd.Environ(), "DOCKER_HOST="+e.DockerHost)

	if e.SudoEnabled && e.SudoPassword != "" {
		cmd.Stdin = strings.NewReader(e.SudoPassword + "\n")
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start: %w", err)
	}

	return stdout, nil
}

// Ping checks if the local execution target is reachable by running "echo ok".
func (e *LocalExecutor) Ping(ctx context.Context) error {
	_, err := e.Run(ctx, "echo", "ok")
	return err
}

// Host returns "local" for the local executor.
func (e *LocalExecutor) Host() string {
	return "local"
}
