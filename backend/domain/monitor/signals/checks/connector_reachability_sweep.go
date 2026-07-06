package checks

import (
	"errors"
	"net"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitorstatus "github.com/websoft9/appos/backend/domain/monitor/status"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	persistence "github.com/websoft9/appos/backend/infra/persistence"
)

const connectorReachabilityProbeConcurrency = 5

var connectorProbeFunc = probeConnector

type ConnectorProbeSnapshot struct {
	Item   *connectors.Connector
	Result ReachabilityResult
}

var connectorReachabilityPriority = map[string]int{
	monitor.StatusHealthy:     0,
	monitor.StatusUnreachable: 1,
	monitor.StatusUnknown:     2,
}

func connectorReachabilityToMonitorStatus(apiStatus string) string {
	switch strings.ToLower(strings.TrimSpace(apiStatus)) {
	case "reachable":
		return monitor.StatusHealthy
	case "unreachable":
		return monitor.StatusUnreachable
	default:
		return monitor.StatusUnknown
	}
}

func resolveConnectorProbeTarget(item *connectors.Connector) (string, int, error) {
	raw := strings.TrimSpace(item.Endpoint())
	if raw == "" {
		return "", 0, errors.New("endpoint is empty")
	}
	parsedRaw := raw
	if !strings.Contains(parsedRaw, "://") {
		parsedRaw = "tcp://" + parsedRaw
	}
	parsed, err := url.Parse(parsedRaw)
	if err != nil {
		return "", 0, err
	}
	host := strings.TrimSpace(parsed.Hostname())
	if host == "" {
		return "", 0, errors.New("endpoint host is empty")
	}
	port := 0
	if rawPort := strings.TrimSpace(parsed.Port()); rawPort != "" {
		port, err = strconv.Atoi(rawPort)
		if err != nil {
			return host, 0, err
		}
	} else {
		switch strings.ToLower(strings.TrimSpace(parsed.Scheme)) {
		case "http":
			port = 80
		case "https":
			port = 443
		case "smtp", "tcp":
			port = 587
		case "smtps":
			port = 465
		case "socks5":
			port = 1080
		default:
			return host, 0, errors.New("endpoint port is required")
		}
	}
	return host, port, nil
}

func probeConnector(item *connectors.Connector) ReachabilityResult {
	return probeConnectorWithTimeout(item, monitor.DefaultPolicySettings().ReachabilityProbeTimeout)
}

func probeConnectorWithTimeout(item *connectors.Connector, timeout time.Duration) ReachabilityResult {
	host, port, err := resolveConnectorProbeTarget(item)
	if err != nil {
		return ReachabilityResult{
			Status: "unknown",
			Reason: err.Error(),
			Host:   host,
			Port:   port,
		}
	}

	start := time.Now()
	conn, dialErr := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), normalizedReachabilityProbeTimeout(timeout))
	if dialErr != nil {
		return ReachabilityResult{
			Status: "unreachable",
			Reason: dialErr.Error(),
			Host:   host,
			Port:   port,
		}
	}
	_ = conn.Close()
	return ReachabilityResult{
		Status:    "reachable",
		LatencyMS: time.Since(start).Milliseconds(),
		Host:      host,
		Port:      port,
	}
}

func ProbeConnectorBatch(items []*connectors.Connector) []ConnectorProbeSnapshot {
	return ProbeConnectorBatchWithTimeout(items, monitor.DefaultPolicySettings().ReachabilityProbeTimeout)
}

func ProbeConnectorBatchWithTimeout(items []*connectors.Connector, timeout time.Duration) []ConnectorProbeSnapshot {
	return probeConnectorBatch(items, func(item *connectors.Connector) ReachabilityResult {
		return probeConnectorWithTimeout(item, timeout)
	})
}

func probeConnectorBatch(items []*connectors.Connector, worker func(*connectors.Connector) ReachabilityResult) []ConnectorProbeSnapshot {
	if len(items) == 0 {
		return nil
	}
	if worker == nil {
		worker = probeConnector
	}
	results := make([]ConnectorProbeSnapshot, len(items))
	concurrency := connectorReachabilityProbeConcurrency
	if concurrency < 1 {
		concurrency = 1
	}
	if concurrency > len(items) {
		concurrency = len(items)
	}

	jobs := make(chan int)
	var wg sync.WaitGroup
	for workerIndex := 0; workerIndex < concurrency; workerIndex++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range jobs {
				item := items[index]
				results[index] = ConnectorProbeSnapshot{
					Item:   item,
					Result: worker(item),
				}
			}
		}()
	}
	for index := range items {
		jobs <- index
	}
	close(jobs)
	wg.Wait()
	return results
}

func RunConnectorReachabilitySweep(app core.App, now time.Time) error {
	repo := persistence.NewConnectorRepository(app)
	items, err := connectors.List(repo, nil)
	if err != nil {
		return err
	}

	var sweepErrors []error
	timeout := LoadReachabilityProbeTimeout(app)
	for _, snapshot := range ProbeConnectorBatchWithTimeout(items, timeout) {
		item := snapshot.Item
		result := snapshot.Result
		status := connectorReachabilityToMonitorStatus(result.Status)

		displayName := item.Name()
		if displayName == "" {
			displayName = item.ID()
		}

		summary := map[string]any{
			"check_kind": monitor.CheckKindReachability,
			"host":       result.Host,
			"port":       result.Port,
		}
		if result.LatencyMS > 0 {
			summary["latency_ms"] = result.LatencyMS
		}

		if err := monitorstatus.ProjectResourceCheckLatestStatus(
			app,
			monitor.TargetTypeConnector,
			item.ID(),
			displayName,
			monitor.SignalSourceAppOS,
			monitor.CheckKindReachability,
			status,
			result.Reason,
			summary,
			connectorReachabilityPriority,
			now,
		); err != nil {
			sweepErrors = append(sweepErrors, err)
		}
	}
	return errors.Join(sweepErrors...)
}

func ProjectConnectorReachability(app core.App, item *connectors.Connector, result ReachabilityResult, now time.Time) error {
	if app == nil || item == nil {
		return nil
	}
	status := connectorReachabilityToMonitorStatus(result.Status)
	displayName := item.Name()
	if displayName == "" {
		displayName = item.ID()
	}
	summary := map[string]any{
		"check_kind": monitor.CheckKindReachability,
		"host":       result.Host,
		"port":       result.Port,
	}
	if result.LatencyMS > 0 {
		summary["latency_ms"] = result.LatencyMS
	}
	return monitorstatus.ProjectResourceCheckLatestStatus(
		app,
		monitor.TargetTypeConnector,
		item.ID(),
		displayName,
		monitor.SignalSourceAppOS,
		monitor.CheckKindReachability,
		status,
		result.Reason,
		summary,
		connectorReachabilityPriority,
		now,
	)
}
