package docker

import (
	"context"
	"io"
)

// Executor abstracts command execution for local (os/exec) or remote (SSH) targets.
// Not Docker-specific — runs any shell command.
type Executor interface {
	// Run executes a command and returns buffered stdout.
	Run(ctx context.Context, command string, args ...string) (string, error)

	// RunStream executes a command and returns a streaming reader for stdout.
	RunStream(ctx context.Context, command string, args ...string) (io.ReadCloser, error)

	// Ping checks if the execution target is reachable.
	Ping(ctx context.Context) error

	// Host returns a label identifying the execution target (e.g. "local", "192.168.1.10").
	Host() string
}
