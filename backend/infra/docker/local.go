package docker

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
	"sort"
	"strings"
)

type localStreamReadCloser struct {
	reader io.ReadCloser
}

func (r *localStreamReadCloser) Read(p []byte) (int, error) {
	return r.reader.Read(p)
}

func (r *localStreamReadCloser) Close() error {
	return r.reader.Close()
}

// LocalExecutor runs commands via os/exec on the local host.
type LocalExecutor struct {
	// DockerHost is the DOCKER_HOST env value (e.g. "unix:///var/run/docker.sock").
	DockerHost string

	// SudoEnabled wraps every command with `sudo` when the process is not root.
	SudoEnabled bool

	// SudoPassword is the password for `sudo -S`. Empty means passwordless sudo (NOPASSWD).
	SudoPassword string

	// Env are extra environment variables injected into Docker commands.
	Env map[string]string
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
		allArgs := make([]string, 0, len(args)+len(e.envPairs())+2)
		if envPairs := e.envPairs(); len(envPairs) > 0 {
			allArgs = append(allArgs, "env")
			allArgs = append(allArgs, envPairs...)
		}
		allArgs = append(allArgs, command)
		allArgs = append(allArgs, args...)
		if e.SudoPassword != "" {
			// -S: read password from stdin; -p '': suppress prompt text
			// #nosec G204 -- command and args are assembled from the validated docker executable and caller-supplied arguments.
			return exec.CommandContext(ctx, "sudo", append([]string{"-S", "-p", "", "--"}, allArgs...)...)
		}
		// Passwordless sudo (-n: non-interactive, fail if password needed)
		// #nosec G204 -- command and args are assembled from the validated docker executable and caller-supplied arguments.
		return exec.CommandContext(ctx, "sudo", append([]string{"-n", "--"}, allArgs...)...)
	}
	return exec.CommandContext(ctx, command, args...)
}

// Run executes a command and returns buffered stdout.
func (e *LocalExecutor) Run(ctx context.Context, command string, args ...string) (string, error) {
	cmd := e.buildCmd(ctx, command, args)
	cmd.Env = e.commandEnv(cmd)

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

// RunStream executes a command and returns a streaming reader for combined stdout/stderr.
func (e *LocalExecutor) RunStream(ctx context.Context, command string, args ...string) (io.ReadCloser, error) {
	cmd := e.buildCmd(ctx, command, args)
	cmd.Env = e.commandEnv(cmd)

	if e.SudoEnabled && e.SudoPassword != "" {
		cmd.Stdin = strings.NewReader(e.SudoPassword + "\n")
	}

	reader, writer := io.Pipe()
	cmd.Stdout = writer
	cmd.Stderr = writer

	if err := cmd.Start(); err != nil {
		_ = writer.Close()
		return nil, fmt.Errorf("start: %w", err)
	}

	go func() {
		if waitErr := cmd.Wait(); waitErr != nil {
			_ = writer.CloseWithError(waitErr)
			return
		}
		_ = writer.Close()
	}()

	return &localStreamReadCloser{reader: reader}, nil
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

func (e *LocalExecutor) SetEnv(env map[string]string) {
	if len(env) == 0 {
		e.Env = nil
		return
	}
	next := make(map[string]string, len(env))
	for key, value := range env {
		if strings.TrimSpace(key) == "" || strings.TrimSpace(value) == "" {
			continue
		}
		next[key] = value
	}
	if len(next) == 0 {
		e.Env = nil
		return
	}
	e.Env = next
}

func (e *LocalExecutor) commandEnv(cmd *exec.Cmd) []string {
	env := append(cmd.Environ(), "DOCKER_HOST="+e.DockerHost)
	keys := make([]string, 0, len(e.Env))
	for key, value := range e.Env {
		if strings.TrimSpace(key) == "" || strings.TrimSpace(value) == "" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		env = append(env, key+"="+e.Env[key])
	}
	return env
}

func (e *LocalExecutor) envPairs() []string {
	if len(e.Env) == 0 {
		return nil
	}
	keys := make([]string, 0, len(e.Env))
	for key, value := range e.Env {
		if strings.TrimSpace(key) == "" || strings.TrimSpace(value) == "" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	pairs := make([]string, 0, len(keys))
	for _, key := range keys {
		pairs = append(pairs, key+"="+e.Env[key])
	}
	return pairs
}
