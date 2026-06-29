package routes

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/websoft9/appos/backend/domain/terminal"
)

type routeSSHCommandRunner func(context.Context, string, time.Duration) (string, error)

var (
	dialRouteSSHClient = terminal.DialSSH
	runRouteSSHSession = terminal.RunSSHSession

	errServerRealtimeSSHBusy = errors.New("server already processing request")

	serverRealtimeSSHGateMu sync.Mutex
	serverRealtimeSSHGates  = map[string]chan struct{}{}
)

func routeSSHCommandAdapter(run routeSSHCommandRunner) func(context.Context, string, time.Duration) (string, error) {
	return func(ctx context.Context, command string, timeout time.Duration) (string, error) {
		return run(ctx, command, timeout)
	}
}

func directSSHCommandAdapter(cfg terminal.ConnectorConfig, env map[string]string) func(context.Context, string, time.Duration) (string, error) {
	return func(ctx context.Context, command string, timeout time.Duration) (string, error) {
		return terminal.ExecuteSSHCommand(ctx, cfg, terminal.WrapCommandWithEnv(command, env), timeout)
	}
}

func reusableRouteSSHCommandRunner(ctx context.Context, cfg terminal.ConnectorConfig, env map[string]string) (routeSSHCommandRunner, func(), error) {
	client, err := dialRouteSSHClient(ctx, cfg)
	if err != nil {
		return nil, nil, err
	}
	cleanup := func() { _ = client.Close() }
	runner := func(runCtx context.Context, command string, timeout time.Duration) (string, error) {
		return runRouteSSHSession(runCtx, client, terminal.WrapCommandWithEnv(command, env), timeout)
	}
	return runner, cleanup, nil
}

func acquireServerRealtimeSSHRead(ctx context.Context, serverID string) (func(), error) {
	gate := serverRealtimeSSHGate(strings.TrimSpace(serverID))
	select {
	case gate <- struct{}{}:
		return func() { <-gate }, nil
	default:
		return nil, errServerRealtimeSSHBusy
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func serverRealtimeSSHGate(serverID string) chan struct{} {
	if serverID == "" {
		serverID = "default"
	}
	serverRealtimeSSHGateMu.Lock()
	defer serverRealtimeSSHGateMu.Unlock()
	gate := serverRealtimeSSHGates[serverID]
	if gate == nil {
		gate = make(chan struct{}, 1)
		serverRealtimeSSHGates[serverID] = gate
	}
	return gate
}
