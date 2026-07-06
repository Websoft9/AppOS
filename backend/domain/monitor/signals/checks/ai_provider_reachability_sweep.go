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
	"github.com/websoft9/appos/backend/domain/resource/aiproviders"
)

var aiProviderReachabilityPriority = map[string]int{
	monitor.StatusHealthy:     0,
	monitor.StatusUnreachable: 1,
	monitor.StatusUnknown:     2,
}

func aiProviderReachabilityToMonitorStatus(apiStatus string) string {
	switch strings.ToLower(strings.TrimSpace(apiStatus)) {
	case "reachable":
		return monitor.StatusHealthy
	case "unreachable":
		return monitor.StatusUnreachable
	default:
		return monitor.StatusUnknown
	}
}

func resolveAIProviderProbeTarget(item *aiproviders.AIProvider) (string, int, error) {
	if item == nil {
		return "", 0, errors.New("provider is nil")
	}
	endpoint, _, err := aiproviders.ResolveActiveEndpointAndProtocol(item)
	if err != nil {
		return "", 0, err
	}
	raw := strings.TrimSpace(endpoint)
	if raw == "" {
		return "", 0, errors.New("endpoint is empty")
	}
	parsedRaw := raw
	if !strings.Contains(parsedRaw, "://") {
		parsedRaw = "https://" + parsedRaw
	}
	parsed, err := url.Parse(parsedRaw)
	if err != nil {
		return "", 0, err
	}
	host := strings.TrimSpace(parsed.Hostname())
	if host == "" {
		return "", 0, errors.New("endpoint host is empty")
	}
	if rawPort := strings.TrimSpace(parsed.Port()); rawPort != "" {
		port, convErr := strconv.Atoi(rawPort)
		if convErr != nil {
			return host, 0, convErr
		}
		return host, port, nil
	}
	switch strings.ToLower(strings.TrimSpace(parsed.Scheme)) {
	case "http":
		return host, 80, nil
	case "https", "":
		return host, 443, nil
	default:
		return host, 0, errors.New("endpoint port is required")
	}
}

func probeAIProvider(item *aiproviders.AIProvider) ReachabilityResult {
	return probeAIProviderWithTimeout(item, monitor.DefaultPolicySettings().ReachabilityProbeTimeout)
}

func probeAIProviderWithTimeout(item *aiproviders.AIProvider, timeout time.Duration) ReachabilityResult {
	host, port, err := resolveAIProviderProbeTarget(item)
	if err != nil {
		return ReachabilityResult{Status: "unknown", Reason: err.Error(), Host: host, Port: port}
	}
	start := time.Now()
	conn, dialErr := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), normalizedReachabilityProbeTimeout(timeout))
	if dialErr != nil {
		return ReachabilityResult{Status: "unreachable", Reason: dialErr.Error(), Host: host, Port: port}
	}
	_ = conn.Close()
	return ReachabilityResult{Status: "reachable", LatencyMS: time.Since(start).Milliseconds(), Host: host, Port: port}
}

func RunAIProviderReachabilitySweep(app core.App, repo aiproviders.Repository, now time.Time) error {
	items, err := aiproviders.List(repo)
	if err != nil {
		return err
	}

	var sweepErrors []error
	timeout := LoadReachabilityProbeTimeout(app)
	for _, item := range items {
		result := probeAIProviderWithTimeout(item, timeout)
		status := aiProviderReachabilityToMonitorStatus(result.Status)

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
			monitor.TargetTypeAIProvider,
			item.ID(),
			displayName,
			monitor.SignalSourceAppOS,
			monitor.CheckKindReachability,
			status,
			result.Reason,
			summary,
			aiProviderReachabilityPriority,
			now,
		); err != nil {
			sweepErrors = append(sweepErrors, err)
		}
	}
	return errors.Join(sweepErrors...)
}
