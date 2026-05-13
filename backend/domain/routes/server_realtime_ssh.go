package routes

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/websoft9/appos/backend/domain/terminal"
)

type routeSSHCommandRunner func(context.Context, string, time.Duration) (string, error)

var (
	dialRouteSSHClient = terminal.DialSSH
	runRouteSSHSession = terminal.RunSSHSession

	serverRealtimeSSHGateMu sync.Mutex
	serverRealtimeSSHGates  = map[string]chan struct{}{}
)

func defaultRouteSSHCommandRunner(cfg terminal.ConnectorConfig) routeSSHCommandRunner {
	return func(ctx context.Context, command string, timeout time.Duration) (string, error) {
		return executeSSHCommand(ctx, cfg, command, timeout)
	}
}

func reusableRouteSSHCommandRunner(ctx context.Context, cfg terminal.ConnectorConfig) (routeSSHCommandRunner, func(), error) {
	client, err := dialRouteSSHClient(ctx, cfg)
	if err != nil {
		return nil, nil, err
	}
	cleanup := func() { _ = client.Close() }
	runner := func(runCtx context.Context, command string, timeout time.Duration) (string, error) {
		return runRouteSSHSession(runCtx, client, command, timeout)
	}
	return runner, cleanup, nil
}

func acquireServerRealtimeSSHRead(ctx context.Context, serverID string) (func(), error) {
	gate := serverRealtimeSSHGate(strings.TrimSpace(serverID))
	select {
	case gate <- struct{}{}:
		return func() { <-gate }, nil
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
