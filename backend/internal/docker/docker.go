// Package docker provides Docker operations for AppOS.
//
// Uses the Executor interface for command execution (local os/exec or remote SSH).
// Client wraps Docker CLI semantics; Executor handles how commands run.
package docker

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// Client wraps Docker CLI operations using an Executor.
type Client struct {
	exec Executor
}

// New creates a new Docker client with the given Executor.
func New(exec Executor) *Client {
	return &Client{exec: exec}
}

// Host returns the executor's host label.
func (c *Client) Host() string {
	return c.exec.Host()
}

// Exec runs an arbitrary docker command. The args are passed directly to "docker <args...>".
func (c *Client) Exec(ctx context.Context, args ...string) (string, error) {
	return c.exec.Run(ctx, "docker", args...)
}

// ─── Docker daemon ───────────────────────────────────────

// Ping checks connectivity to the Docker daemon.
func (c *Client) Ping(ctx context.Context) error {
	_, err := c.exec.Run(ctx, "docker", "info", "--format", "{{.ID}}")
	return err
}

// ─── Compose operations ─────────────────────────────────

func (c *Client) composeFile(projectDir string) string {
	return projectDir + "/docker-compose.yml"
}

// ComposeUp runs docker compose up -d.
func (c *Client) ComposeUp(ctx context.Context, projectDir string) (string, error) {
	return c.exec.Run(ctx, "docker", "compose", "-f", c.composeFile(projectDir), "up", "-d")
}

// ComposeDown runs docker compose down.
func (c *Client) ComposeDown(ctx context.Context, projectDir string, removeVolumes bool) (string, error) {
	args := []string{"compose", "-f", c.composeFile(projectDir), "down"}
	if removeVolumes {
		args = append(args, "-v")
	}
	return c.exec.Run(ctx, "docker", args...)
}

// ComposeStart runs docker compose start.
func (c *Client) ComposeStart(ctx context.Context, projectDir string) (string, error) {
	return c.exec.Run(ctx, "docker", "compose", "-f", c.composeFile(projectDir), "start")
}

// ComposeStop runs docker compose stop.
func (c *Client) ComposeStop(ctx context.Context, projectDir string) (string, error) {
	return c.exec.Run(ctx, "docker", "compose", "-f", c.composeFile(projectDir), "stop")
}

// ComposeRestart runs docker compose restart.
func (c *Client) ComposeRestart(ctx context.Context, projectDir string) (string, error) {
	return c.exec.Run(ctx, "docker", "compose", "-f", c.composeFile(projectDir), "restart")
}

// ComposeLogs returns logs for the given compose project.
func (c *Client) ComposeLogs(ctx context.Context, projectDir string, tail int) (string, error) {
	return c.exec.Run(ctx, "docker", "compose", "-f", c.composeFile(projectDir), "logs", "--tail", fmt.Sprintf("%d", tail))
}

// ComposeLogsStream returns a streaming reader for compose logs.
func (c *Client) ComposeLogsStream(ctx context.Context, projectDir string, tail int) (io.ReadCloser, error) {
	return c.exec.RunStream(ctx, "docker", "compose", "-f", c.composeFile(projectDir), "logs", "--tail", fmt.Sprintf("%d", tail), "-f")
}

// ComposeConfigRead reads the docker-compose.yml file content.
func (c *Client) ComposeConfigRead(projectDir string) (string, error) {
	data, err := os.ReadFile(filepath.Join(projectDir, "docker-compose.yml"))
	if err != nil {
		return "", fmt.Errorf("read compose config: %w", err)
	}
	return string(data), nil
}

// ComposeConfigWrite writes content to the docker-compose.yml file.
func (c *Client) ComposeConfigWrite(projectDir string, content string) error {
	path := filepath.Join(projectDir, "docker-compose.yml")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return fmt.Errorf("write compose config: %w", err)
	}
	return nil
}

// ComposeLs lists compose projects in JSON format.
func (c *Client) ComposeLs(ctx context.Context) (string, error) {
	return c.exec.Run(ctx, "docker", "compose", "ls", "--format", "json")
}

// ─── Image operations ────────────────────────────────────

// ImageList returns images in JSON format.
func (c *Client) ImageList(ctx context.Context) (string, error) {
	return c.exec.Run(ctx, "docker", "image", "ls", "--format", "json")
}

// ImagePull pulls an image by name.
func (c *Client) ImagePull(ctx context.Context, name string) (string, error) {
	return c.exec.Run(ctx, "docker", "pull", name)
}

// ImageRemove removes an image by ID.
func (c *Client) ImageRemove(ctx context.Context, id string) (string, error) {
	return c.exec.Run(ctx, "docker", "image", "rm", id)
}

// ImagePrune removes unused images.
func (c *Client) ImagePrune(ctx context.Context) (string, error) {
	return c.exec.Run(ctx, "docker", "image", "prune", "-f")
}

// ─── Container operations ────────────────────────────────

// ContainerList returns all containers in JSON format.
func (c *Client) ContainerList(ctx context.Context) (string, error) {
	return c.exec.Run(ctx, "docker", "ps", "-a", "--format", "json")
}

// ContainerInspect returns detailed info for a container.
func (c *Client) ContainerInspect(ctx context.Context, id string) (string, error) {
	return c.exec.Run(ctx, "docker", "inspect", id)
}

// ContainerStats returns one-shot stats for all containers in JSON format.
func (c *Client) ContainerStats(ctx context.Context) (string, error) {
	return c.exec.Run(ctx, "docker", "stats", "--no-stream", "--format", "json")
}

// ContainerLogs returns container logs with tail limit.
func (c *Client) ContainerLogs(ctx context.Context, id string, tail int) (string, error) {
	return c.exec.Run(ctx, "docker", "logs", "--tail", fmt.Sprintf("%d", tail), id)
}

// ContainerStart starts a container.
func (c *Client) ContainerStart(ctx context.Context, id string) (string, error) {
	return c.exec.Run(ctx, "docker", "start", id)
}

// ContainerStop stops a container.
func (c *Client) ContainerStop(ctx context.Context, id string) (string, error) {
	return c.exec.Run(ctx, "docker", "stop", id)
}

// ContainerRestart restarts a container.
func (c *Client) ContainerRestart(ctx context.Context, id string) (string, error) {
	return c.exec.Run(ctx, "docker", "restart", id)
}

// ContainerRemove removes a container.
func (c *Client) ContainerRemove(ctx context.Context, id string) (string, error) {
	return c.exec.Run(ctx, "docker", "rm", id)
}

// ─── Network operations ──────────────────────────────────

// NetworkList returns networks in JSON format.
func (c *Client) NetworkList(ctx context.Context) (string, error) {
	return c.exec.Run(ctx, "docker", "network", "ls", "--format", "json")
}

// NetworkCreate creates a network.
func (c *Client) NetworkCreate(ctx context.Context, name string) (string, error) {
	return c.exec.Run(ctx, "docker", "network", "create", name)
}

// NetworkRemove removes a network.
func (c *Client) NetworkRemove(ctx context.Context, id string) (string, error) {
	return c.exec.Run(ctx, "docker", "network", "rm", id)
}

// ─── Volume operations ───────────────────────────────────

// VolumeList returns volumes in JSON format.
func (c *Client) VolumeList(ctx context.Context) (string, error) {
	return c.exec.Run(ctx, "docker", "volume", "ls", "--format", "json")
}

// VolumeRemove removes a volume.
func (c *Client) VolumeRemove(ctx context.Context, id string) (string, error) {
	return c.exec.Run(ctx, "docker", "volume", "rm", id)
}

// VolumePrune removes unused volumes.
func (c *Client) VolumePrune(ctx context.Context) (string, error) {
	return c.exec.Run(ctx, "docker", "volume", "prune", "-f")
}
