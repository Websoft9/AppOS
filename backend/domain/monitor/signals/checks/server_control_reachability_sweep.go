package checks

import (
	"errors"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitorstatus "github.com/websoft9/appos/backend/domain/monitor/status"
	"github.com/websoft9/appos/backend/domain/monitor/status/store"
	"github.com/websoft9/appos/backend/domain/resource/servers"
)

func RunServerControlReachabilitySweep(app core.App, now time.Time) error {
	records, err := app.FindAllRecords("servers")
	if err != nil {
		return err
	}
	var sweepErrors []error
	for _, record := range records {
		server := servers.ManagedServerFromRecord(record)
		if server == nil || server.ID == "" {
			continue
		}
		result := ProbeServerControlReachability(record)
		if err := projectServerControlReachability(app, server, result, now); err != nil {
			sweepErrors = append(sweepErrors, err)
		}
	}
	return errors.Join(sweepErrors...)
}

func projectServerControlReachability(app core.App, server *servers.ManagedServer, result ServerControlReachabilityResult, now time.Time) error {
	entry, ok, err := monitor.ResolveTargetRegistryEntry(monitor.TargetTypeServer, "", "")
	if err != nil || !ok {
		entry = monitor.TargetRegistryEntry{}
	}
	status := serverControlReachabilityStatus(result.Outcome)
	reason := serverControlReachabilityReason(result.Outcome, result.Reason)
	reasonCode := serverControlReachabilityReasonCode(result.Outcome)

	summary := store.LoadExistingSummary(app, monitor.TargetTypeServer, server.ID)
	summary["check_kind"] = monitor.CheckKindControlReachability
	summary["signal_source"] = monitor.SignalSourceAppOS
	summary["control_reachability_state"] = result.Outcome
	summary["probe_protocol"] = result.Protocol
	summary["host"] = result.Host
	summary["port"] = result.Port
	if reasonCode != "" {
		summary["control_reason_code"] = reasonCode
		summary["reason_code"] = reasonCode
	} else {
		delete(summary, "control_reason_code")
		delete(summary, "reason_code")
	}
	if result.LatencyMS > 0 {
		summary["latency_ms"] = result.LatencyMS
	} else {
		delete(summary, "latency_ms")
	}

	failures, lastSuccessAt, lastFailureAt := monitorstatus.ResourceCheckFailureState(app, monitor.TargetTypeServer, server.ID, status, now)
	_, err = store.UpsertLatestStatus(app, store.LatestStatusUpsert{
		TargetType:              monitor.TargetTypeServer,
		TargetID:                server.ID,
		DisplayName:             firstNonEmptyString(server.Name, server.ID),
		Status:                  status,
		Reason:                  reason,
		SignalSource:            monitor.SignalSourceAppOS,
		LastTransitionAt:        now.UTC(),
		LastSuccessAt:           lastSuccessAt,
		LastFailureAt:           lastFailureAt,
		LastCheckedAt:           &now,
		ConsecutiveFailures:     &failures,
		Summary:                 summary,
		StatusPriorityMap:       entry.StatusPriority,
		PreserveStrongerFailure: true,
	})
	return err
}

func serverControlReachabilityStatus(outcome string) string {
	switch outcome {
	case ControlReachabilityReachable:
		return monitor.StatusHealthy
	case ControlReachabilityUnreachable, ControlReachabilityTunnelUnavailable:
		return monitor.StatusUnreachable
	default:
		return monitor.StatusUnknown
	}
}

func serverControlReachabilityReasonCode(outcome string) string {
	switch outcome {
	case ControlReachabilityReachable:
		return ""
	case ControlReachabilityUnreachable:
		return "control_unreachable"
	case ControlReachabilityTunnelUnavailable:
		return "tunnel_unavailable"
	default:
		return "control_reachability_unknown"
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
