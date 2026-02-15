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
}

// NewLocalExecutor creates a LocalExecutor with the given Docker host.
func NewLocalExecutor(dockerHost string) *LocalExecutor {
	if dockerHost == "" {
		dockerHost = "unix:///var/run/docker.sock"
	}
	return &LocalExecutor{DockerHost: dockerHost}
}

// Run executes a command and returns buffered stdout.
func (e *LocalExecutor) Run(ctx context.Context, command string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Env = append(cmd.Environ(), "DOCKER_HOST="+e.DockerHost)

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
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Env = append(cmd.Environ(), "DOCKER_HOST="+e.DockerHost)

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
