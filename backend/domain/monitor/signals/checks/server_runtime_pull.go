package checks

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	snapshots "github.com/websoft9/appos/backend/domain/monitor/signals/snapshots"
	"github.com/websoft9/appos/backend/domain/resource/servers"
	"github.com/websoft9/appos/backend/domain/terminal"
)

const serverRuntimePullTimeout = 20 * time.Second

var executeServerRuntimeCommand = terminal.ExecuteSSHCommand

func SetServerRuntimeCommandExecutorForTest(fn func(context.Context, terminal.ConnectorConfig, string, time.Duration) (string, error)) func() {
	previous := executeServerRuntimeCommand
	if fn == nil {
		executeServerRuntimeCommand = terminal.ExecuteSSHCommand
	} else {
		executeServerRuntimeCommand = fn
	}
	return func() {
		executeServerRuntimeCommand = previous
	}
}

func RunServerRuntimeSnapshotPullSweep(app core.App, now time.Time) error {
	items, err := servers.ListManagedServers(app)
	if err != nil {
		return err
	}
	var sweepErrors []error
	for _, server := range items {
		if server == nil || server.ID == "" {
			continue
		}
		if err := PullServerRuntimeSnapshot(app, server.ID, now); err != nil {
			sweepErrors = append(sweepErrors, fmt.Errorf("server %s runtime pull: %w", server.ID, err))
		}
	}
	return errors.Join(sweepErrors...)
}

func PullServerRuntimeSnapshot(app core.App, serverID string, now time.Time) error {
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return fmt.Errorf("server id is required")
	}
	server, err := servers.LoadManagedServer(app, serverID)
	if err != nil {
		return err
	}
	cfg, err := servers.ResolveConfigForUserID(app, serverID, "")
	if err != nil {
		return err
	}
	output, err := executeServerRuntimeCommand(context.Background(), terminal.ConnectorConfig{
		Host:     cfg.Host,
		Port:     cfg.Port,
		User:     cfg.User,
		AuthType: terminal.CredAuthType(cfg.AuthType),
		Secret:   cfg.Secret,
		Shell:    cfg.Shell,
	}, serverRuntimeCommand(), serverRuntimePullTimeout)
	if err != nil {
		return err
	}
	containers := ParseServerRuntimeCommandOutput(output)
	runtimeState := RuntimeStateFromContainerSummary(containers)
	if now.IsZero() {
		now = time.Now().UTC()
	}
	_, err = snapshots.IngestRuntimeStatus(app, snapshots.RuntimeStatusIngest{
		ServerID:     server.ID,
		ServerName:   server.Name,
		ReportedAt:   now.UTC(),
		SignalSource: monitor.SignalSourceAppOS,
		Items: []snapshots.RuntimeStatusItem{{
			TargetType:   monitor.TargetTypeServer,
			TargetID:     server.ID,
			RuntimeState: runtimeState,
			ObservedAt:   now.UTC(),
			Containers:   containers,
		}},
	})
	return err
}

func ParseServerRuntimeCommandOutput(output string) snapshots.RuntimeContainerSummary {
	summary := snapshots.RuntimeContainerSummary{}
	for _, line := range strings.Split(output, "\n") {
		state := strings.ToLower(strings.TrimSpace(line))
		switch state {
		case "running":
			summary.Running++
		case "restarting":
			summary.Restarting++
		case "exited", "created", "dead", "removing", "paused":
			summary.Exited++
		}
	}
	return summary
}

func RuntimeStateFromContainerSummary(summary snapshots.RuntimeContainerSummary) string {
	if summary.Restarting > 0 {
		return monitor.StatusDegraded
	}
	if summary.Running > 0 {
		return monitor.StatusHealthy
	}
	if summary.Exited > 0 {
		return "stopped"
	}
	return monitor.StatusUnknown
}

func serverRuntimeCommand() string {
	return "docker ps -a --format '{{.State}}' 2>/dev/null || true"
}
