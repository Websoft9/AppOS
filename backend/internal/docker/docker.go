// Package docker provides Docker operations for AppOS.
//
// Uses the Docker CLI via os/exec for container and compose management.
// This avoids Docker SDK version coupling and provides a thin, testable wrapper.
package docker

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// Client wraps Docker CLI operations.
type Client struct {
	host string
}

// New creates a new Docker client.
func New(host string) *Client {
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	return &Client{host: host}
}

// Ping checks connectivity to the Docker daemon.
func (c *Client) Ping(ctx context.Context) error {
	_, err := c.run(ctx, "docker", "info", "--format", "{{.ID}}")
	return err
}

// ComposeUp runs docker compose up for the given project directory.
func (c *Client) ComposeUp(ctx context.Context, projectDir string) (string, error) {
	return c.run(ctx, "docker", "compose", "-f", projectDir+"/docker-compose.yml", "up", "-d")
}

// ComposeDown runs docker compose down for the given project directory.
func (c *Client) ComposeDown(ctx context.Context, projectDir string, removeVolumes bool) (string, error) {
	if removeVolumes {
		return c.run(ctx, "docker", "compose", "-f", projectDir+"/docker-compose.yml", "down", "-v")
	}
	return c.run(ctx, "docker", "compose", "-f", projectDir+"/docker-compose.yml", "down")
}

// ComposeRestart runs docker compose restart for the given project directory.
func (c *Client) ComposeRestart(ctx context.Context, projectDir string) (string, error) {
	return c.run(ctx, "docker", "compose", "-f", projectDir+"/docker-compose.yml", "restart")
}

// ComposeStop runs docker compose stop for the given project directory.
func (c *Client) ComposeStop(ctx context.Context, projectDir string) (string, error) {
	return c.run(ctx, "docker", "compose", "-f", projectDir+"/docker-compose.yml", "stop")
}

// ComposeLogs returns logs for the given project.
func (c *Client) ComposeLogs(ctx context.Context, projectDir string, tail int) (string, error) {
	return c.run(ctx, "docker", "compose", "-f", projectDir+"/docker-compose.yml", "logs", "--tail", fmt.Sprintf("%d", tail))
}

// run executes a command and returns combined output.
func (c *Client) run(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = append(cmd.Environ(), "DOCKER_HOST="+c.host)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%s: %w", strings.TrimSpace(stderr.String()), err)
	}
	return strings.TrimSpace(stdout.String()), nil
}
