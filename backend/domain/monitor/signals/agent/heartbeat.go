package agent

import (
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitorstatus "github.com/websoft9/appos/backend/domain/monitor/status"
)

type HeartbeatIngest struct {
	ServerID     string
	ServerName   string
	AgentVersion string
	ReportedAt   time.Time
	ReceivedAt   time.Time
	Items        []HeartbeatItem
}

type HeartbeatItem struct {
	TargetType string
	TargetID   string
	ObservedAt time.Time
}

func IngestHeartbeat(app core.App, input HeartbeatIngest) (int, error) {
	serverID := strings.TrimSpace(input.ServerID)
	now := input.ReceivedAt
	if now.IsZero() {
		now = time.Now().UTC()
	}
	serverEntry, ok, err := monitor.ResolveTargetRegistryEntry(monitor.TargetTypeServer, "", "")
	if err != nil || !ok {
		serverEntry = monitor.TargetRegistryEntry{}
	}
	accepted := 0
	for _, item := range input.Items {
		if strings.TrimSpace(item.TargetType) != monitor.TargetTypeServer {
			return accepted, ErrHeartbeatTargetTypeUnsupported
		}
		if strings.TrimSpace(item.TargetID) == "" || strings.TrimSpace(item.TargetID) != serverID {
			return accepted, ErrHeartbeatTargetMismatch
		}
		observedAt := item.ObservedAt
		if observedAt.IsZero() {
			observedAt = input.ReportedAt
		}
		projection := monitorstatus.EvaluateHeartbeat(serverEntry, observedAt, now)
		summary := map[string]any{
			"heartbeat_state": projection.HeartbeatState,
		}
		monitorstatus.ApplyReasonCode(summary, projection.ReasonCode)
		if strings.TrimSpace(input.AgentVersion) != "" {
			summary["agent_version"] = strings.TrimSpace(input.AgentVersion)
		}
		failures := 0
		lastSuccessAt := (*time.Time)(nil)
		lastFailureAt := (*time.Time)(nil)
		if projection.Status == monitor.StatusHealthy {
			lastSuccessAt = &observedAt
		} else {
			failures = 1
			nowUTC := now.UTC()
			lastFailureAt = &nowUTC
		}
		err = monitorstatus.ApplySignalEvent(app, monitor.CanonicalSignalEvent{
			TargetType:              monitor.TargetTypeServer,
			TargetID:                serverID,
			DisplayName:             input.ServerName,
			Status:                  projection.Status,
			Reason:                  projection.Reason,
			SignalSource:            monitor.SignalSourceAgent,
			ObservedAt:              now,
			LastSuccessAt:           lastSuccessAt,
			LastFailureAt:           lastFailureAt,
			LastReportedAt:          &observedAt,
			ConsecutiveFailures:     &failures,
			Summary:                 summary,
			StatusPriorityMap:       serverEntry.StatusPriority,
			PreserveStrongerFailure: true,
		})
		if err != nil {
			return accepted, err
		}
		accepted++
	}
	return accepted, nil
}
