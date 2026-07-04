package checks

import (
	"errors"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitorstatus "github.com/websoft9/appos/backend/domain/monitor/status"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	persistence "github.com/websoft9/appos/backend/infra/persistence"
)

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
	conn, dialErr := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), 3*time.Second)
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

func RunConnectorReachabilitySweep(app core.App, now time.Time) error {
	repo := persistence.NewConnectorRepository(app)
	items, err := connectors.List(repo, nil)
	if err != nil {
		return err
	}

	var sweepErrors []error
	for _, item := range items {
		result := probeConnector(item)
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
