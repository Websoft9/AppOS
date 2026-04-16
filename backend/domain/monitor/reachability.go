package monitor

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/resource/instances"
	persistence "github.com/websoft9/appos/backend/infra/persistence"
)

const CheckKindReachability = "reachability"

type ReachabilityResult struct {
	Status    string
	LatencyMS int64
	Reason    string
	Protocol  string
	Host      string
	Port      int
}

func ProbeInstanceReachability(item *instances.Instance) ReachabilityResult {
	host, port, err := instanceProbeTarget(item.Endpoint(), item.Kind())
	if err != nil {
		return ReachabilityResult{
			Status:   "unknown",
			Reason:   err.Error(),
			Protocol: "tcp",
			Host:     host,
			Port:     port,
		}
	}

	addr := net.JoinHostPort(host, strconv.Itoa(port))
	start := time.Now()
	conn, dialErr := net.DialTimeout("tcp", addr, 3*time.Second)
	if dialErr != nil {
		return ReachabilityResult{
			Status:   "offline",
			Reason:   dialErr.Error(),
			Protocol: "tcp",
			Host:     host,
			Port:     port,
		}
	}
	_ = conn.Close()
	return ReachabilityResult{
		Status:    "online",
		LatencyMS: time.Since(start).Milliseconds(),
		Protocol:  "tcp",
		Host:      host,
		Port:      port,
	}
}

func RunInstanceReachabilitySweep(app core.App, now time.Time) error {
	items, err := instances.List(persistence.NewInstanceRepository(app), nil)
	if err != nil {
		return err
	}
	for _, item := range items {
		target, ok, err := ResolveInstanceTarget(item)
		if err != nil {
			return err
		}
		if !ok {
			continue
		}
		eligible, _ := target.EligibleForReachability()
		if !eligible {
			continue
		}
		result := ProbeInstanceReachability(item)
		if err := projectInstanceReachability(app, target, result, now); err != nil {
			return err
		}
	}
	return nil
}

func projectInstanceReachability(app core.App, target ResolvedInstanceTarget, result ReachabilityResult, now time.Time) error {
	item := target.Item
	status := target.ReachabilityStatusFor(result.Status)
	reason := target.ReachabilityReasonFor(result.Status, result.Reason)
	lastSuccessAt := (*time.Time)(nil)
	lastFailureAt := (*time.Time)(nil)
	failures := previousFailureCount(app, TargetTypeResource, item.ID())

	switch result.Status {
	case "online":
		failures = 0
		lastSuccessAt = &now
	case "offline":
		failures++
		lastFailureAt = &now
	default:
		failures++
		lastFailureAt = &now
	}

	summary := LoadExistingSummary(app, TargetTypeResource, item.ID())
	summary["check_kind"] = CheckKindReachability
	summary["registry_entry_id"] = target.Entry.ID
	summary["probe_protocol"] = result.Protocol
	summary["host"] = result.Host
	summary["port"] = result.Port
	summary["resource_kind"] = item.Kind()
	summary["template_id"] = item.TemplateID()
	summary["endpoint"] = item.Endpoint()
	ApplyReasonCode(summary, target.ReachabilityReasonCodeFor(result.Status, ""))
	if result.LatencyMS > 0 {
		summary["latency_ms"] = result.LatencyMS
	} else {
		delete(summary, "latency_ms")
	}

	_, err := UpsertLatestStatus(app, LatestStatusUpsert{
		TargetType:              TargetTypeResource,
		TargetID:                item.ID(),
		DisplayName:             firstNonEmpty(item.Name(), item.ID()),
		Status:                  status,
		Reason:                  reason,
		SignalSource:            SignalSourceAppOS,
		LastTransitionAt:        now,
		LastSuccessAt:           lastSuccessAt,
		LastFailureAt:           lastFailureAt,
		LastCheckedAt:           &now,
		ConsecutiveFailures:     &failures,
		Summary:                 summary,
		StatusPriorityMap:       target.Entry.StatusPriority,
		PreserveStrongerFailure: preserveStrongerFailureFromOtherCheck(app, TargetTypeResource, item.ID(), CheckKindReachability),
	})
	return err
}

func previousFailureCount(app core.App, targetType string, targetID string) int {
	record, err := app.FindFirstRecordByFilter(
		"monitor_latest_status",
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": strings.TrimSpace(targetType), "targetID": strings.TrimSpace(targetID)},
	)
	if err != nil {
		return 0
	}
	return record.GetInt("consecutive_failures")
}

func instanceProbeTarget(endpoint string, kind string) (string, int, error) {
	raw := strings.TrimSpace(endpoint)
	if raw == "" {
		return "", 0, errors.New("instance endpoint is empty")
	}

	if strings.Contains(raw, "://") {
		parsed, err := url.Parse(raw)
		if err != nil {
			return "", 0, fmt.Errorf("invalid instance endpoint: %w", err)
		}
		host := strings.TrimSpace(parsed.Hostname())
		if host == "" {
			return "", 0, errors.New("instance endpoint host is empty")
		}
		if parsed.Port() != "" {
			port, err := strconv.Atoi(parsed.Port())
			if err != nil {
				return "", 0, errors.New("instance endpoint port is invalid")
			}
			return host, port, nil
		}
		if port := defaultInstanceProbePort(kind, parsed.Scheme); port > 0 {
			return host, port, nil
		}
		return "", 0, errors.New("instance endpoint port is empty")
	}

	host, portText, err := net.SplitHostPort(raw)
	if err == nil {
		port, convErr := strconv.Atoi(portText)
		if convErr != nil {
			return "", 0, errors.New("instance endpoint port is invalid")
		}
		return host, port, nil
	}

	if port := defaultInstanceProbePort(kind, ""); port > 0 {
		return raw, port, nil
	}

	return "", 0, errors.New("instance endpoint port is empty")
}

func defaultInstanceProbePort(kind string, scheme string) int {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case instances.KindMySQL:
		return 3306
	case instances.KindPostgres:
		return 5432
	case instances.KindRedis:
		return 6379
	case instances.KindKafka:
		return 9092
	case instances.KindOllama:
		return 11434
	}

	switch strings.ToLower(strings.TrimSpace(scheme)) {
	case "https":
		return 443
	case "http":
		return 80
	}

	return 0
}
