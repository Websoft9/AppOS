package checks

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	snapshots "github.com/websoft9/appos/backend/domain/monitor/signals/snapshots"
	"github.com/websoft9/appos/backend/domain/resource/servers"
	"github.com/websoft9/appos/backend/domain/terminal"
)

const serverFactsPullTimeout = 20 * time.Second
const serverFactsPullConcurrency = 5

var executeServerFactsCommand = terminal.ExecuteSSHCommand

func SetServerFactsCommandExecutorForTest(fn func(context.Context, terminal.ConnectorConfig, string, time.Duration) (string, error)) func() {
	previous := executeServerFactsCommand
	if fn == nil {
		executeServerFactsCommand = terminal.ExecuteSSHCommand
	} else {
		executeServerFactsCommand = fn
	}
	return func() {
		executeServerFactsCommand = previous
	}
}

func RunServerFactsPullSweep(app core.App, now time.Time) error {
	items, err := servers.ListManagedServers(app)
	if err != nil {
		return err
	}
	var (
		wg          sync.WaitGroup
		mu          sync.Mutex
		sweepErrors []error
		sem         = make(chan struct{}, serverFactsPullConcurrency)
	)
	for _, server := range items {
		if server == nil || server.ID == "" {
			continue
		}
		serverID := server.ID
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() {
				<-sem
				if recovered := recover(); recovered != nil {
					mu.Lock()
					sweepErrors = append(sweepErrors, fmt.Errorf("server %s facts pull panic: %v", serverID, recovered))
					mu.Unlock()
				}
			}()
			if err := PullServerFactsSnapshot(app, serverID, now); err != nil {
				mu.Lock()
				sweepErrors = append(sweepErrors, fmt.Errorf("server %s facts pull: %w", serverID, err))
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	return errors.Join(sweepErrors...)
}

func PullServerFactsSnapshot(app core.App, serverID string, now time.Time) error {
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
	output, err := executeServerFactsCommand(context.Background(), terminal.ConnectorConfig{
		Host:     cfg.Host,
		Port:     cfg.Port,
		User:     cfg.User,
		AuthType: terminal.CredAuthType(cfg.AuthType),
		Secret:   cfg.Secret,
		Shell:    cfg.Shell,
	}, serverFactsCommand(), serverFactsPullTimeout)
	if err != nil {
		return err
	}
	facts, err := ParseServerFactsCommandOutput(output)
	if err != nil {
		return err
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	_, err = snapshots.IngestFacts(app, snapshots.FactsIngest{
		ServerID:   server.ID,
		ServerName: server.Name,
		ReportedAt: now.UTC(),
		Items: []snapshots.FactsItem{{
			TargetType: monitor.TargetTypeServer,
			TargetID:   server.ID,
			Facts:      facts,
			ObservedAt: now.UTC(),
		}},
	})
	return err
}

func ParseServerFactsCommandOutput(output string) (map[string]any, error) {
	values := map[string]string{}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		values[strings.TrimSpace(key)] = strings.TrimSpace(value)
	}
	required := []string{"os.family", "os.distribution", "os.version", "kernel.release", "architecture", "cpu.cores", "memory.total_bytes"}
	for _, key := range required {
		if values[key] == "" {
			return nil, fmt.Errorf("facts command output missing %s", key)
		}
	}
	cpuCores, err := strconv.ParseInt(values["cpu.cores"], 10, 64)
	if err != nil || cpuCores <= 0 {
		return nil, fmt.Errorf("invalid cpu.cores %q", values["cpu.cores"])
	}
	memoryTotalBytes, err := strconv.ParseInt(values["memory.total_bytes"], 10, 64)
	if err != nil || memoryTotalBytes <= 0 {
		return nil, fmt.Errorf("invalid memory.total_bytes %q", values["memory.total_bytes"])
	}
	return map[string]any{
		"os": map[string]any{
			"family":       values["os.family"],
			"distribution": values["os.distribution"],
			"version":      values["os.version"],
		},
		"kernel": map[string]any{
			"release": values["kernel.release"],
		},
		"architecture": values["architecture"],
		"cpu": map[string]any{
			"cores": cpuCores,
		},
		"memory": map[string]any{
			"total_bytes": memoryTotalBytes,
		},
	}, nil
}

func serverFactsCommand() string {
	return strings.Join([]string{
		"set -eu",
		"os_family=$(uname -s 2>/dev/null || printf unknown)",
		"os_distribution=",
		"os_version=",
		"if [ -r /etc/os-release ]; then . /etc/os-release; os_distribution=${NAME:-${ID:-}}; os_version=${VERSION_ID:-${VERSION:-}}; fi",
		"if [ -z \"$os_distribution\" ]; then os_distribution=$os_family; fi",
		"if [ -z \"$os_version\" ]; then os_version=unknown; fi",
		"kernel_release=$(uname -r 2>/dev/null || printf unknown)",
		"architecture=$(uname -m 2>/dev/null || printf unknown)",
		"cpu_cores=$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || printf 1)",
		"memory_total_bytes=$(awk '/^MemTotal:/ {printf \"%d\", $2 * 1024}' /proc/meminfo 2>/dev/null || printf 1)",
		"printf 'os.family=%s\\n' \"$os_family\"",
		"printf 'os.distribution=%s\\n' \"$os_distribution\"",
		"printf 'os.version=%s\\n' \"$os_version\"",
		"printf 'kernel.release=%s\\n' \"$kernel_release\"",
		"printf 'architecture=%s\\n' \"$architecture\"",
		"printf 'cpu.cores=%s\\n' \"$cpu_cores\"",
		"printf 'memory.total_bytes=%s\\n' \"$memory_total_bytes\"",
	}, " && ")
}
