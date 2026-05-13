package checks

import (
	"errors"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitorstatus "github.com/websoft9/appos/backend/domain/monitor/status"
	monitorstore "github.com/websoft9/appos/backend/domain/monitor/status/store"
)

func RunAppHealthSweep(app core.App, now time.Time) error {
	col, err := app.FindCollectionByNameOrId("app_instances")
	if err != nil {
		return err
	}
	records, err := app.FindRecordsByFilter(col, `lifecycle_state != "retired"`, "-updated", 0, 0)
	if err != nil {
		return err
	}
	entry := monitor.ResolveAppBaselineTarget()
	var sweepErrors []error
	for _, record := range records {
		if err := projectAppHealth(app, entry, record, now); err != nil {
			sweepErrors = append(sweepErrors, err)
		}
	}
	return errors.Join(sweepErrors...)
}

func projectAppHealth(app core.App, entry monitor.TargetRegistryEntry, record *core.Record, now time.Time) error {
	targetID := strings.TrimSpace(record.Id)
	runtimeStatus := normalizedAppRuntimeStatus(record)
	healthSummary := strings.ToLower(strings.TrimSpace(record.GetString("health_summary")))
	publicationSummary := strings.TrimSpace(record.GetString("publication_summary"))
	serverID := strings.TrimSpace(record.GetString("server_id"))
	outcome := appHealthOutcome(runtimeStatus, healthSummary)
	status := entry.AppHealthStatusFor(outcome)
	reason := entry.AppHealthReasonFor(outcome, appHealthFallbackReason(outcome, healthSummary))
	failures, lastSuccessAt, lastFailureAt := monitorstatus.FailureStateFromPrevious(
		monitorstore.PreviousFailureCount(app, monitor.TargetTypeApp, targetID),
		status,
		monitor.StatusHealthy,
		now,
	)
	summary := monitorstatus.LoadExistingSummary(app, monitor.TargetTypeApp, targetID)
	summary["check_kind"] = monitor.CheckKindAppHealth
	summary["runtime_status"] = runtimeStatus
	summary["health_summary"] = healthSummary
	summary["publication_summary"] = publicationSummary
	summary["server_id"] = serverID
	monitorstatus.ApplyReasonCode(summary, entry.AppHealthReasonCodeFor(outcome, ""))
	return monitorstatus.ApplySignalEvent(app, monitor.CanonicalSignalEvent{
		TargetType:              monitor.TargetTypeApp,
		TargetID:                targetID,
		DisplayName:             appDisplayName(record),
		Status:                  status,
		Reason:                  reason,
		SignalSource:            monitor.SignalSourceAppOS,
		ObservedAt:              now,
		LastSuccessAt:           lastSuccessAt,
		LastFailureAt:           lastFailureAt,
		LastCheckedAt:           &now,
		ConsecutiveFailures:     &failures,
		Summary:                 summary,
		StatusPriorityMap:       entry.StatusPriority,
		PreserveStrongerFailure: true,
	})
}

func appHealthOutcome(runtimeStatus, healthSummary string) string {
	switch strings.TrimSpace(runtimeStatus) {
	case "stopped", "stopping", "exited":
		return monitor.StatusOffline
	case "running", "healthy":
		switch strings.TrimSpace(healthSummary) {
		case "healthy", "":
			return monitor.StatusHealthy
		case "stopped":
			return monitor.StatusOffline
		case "degraded", "error", "failed", "unhealthy":
			return monitor.StatusDegraded
		default:
			return monitor.StatusUnknown
		}
	case "degraded", "restarting", "error", "failed":
		return monitor.StatusDegraded
	case "":
		switch strings.TrimSpace(healthSummary) {
		case "healthy":
			return monitor.StatusHealthy
		case "stopped":
			return monitor.StatusOffline
		case "degraded", "error", "failed", "unhealthy":
			return monitor.StatusDegraded
		default:
			return monitor.StatusUnknown
		}
	default:
		return monitor.StatusUnknown
	}
}

func appHealthFallbackReason(outcome, healthSummary string) string {
	trimmed := strings.TrimSpace(healthSummary)
	if trimmed == "" {
		return ""
	}
	if outcome == monitor.StatusHealthy {
		return ""
	}
	return trimmed
}

func normalizedAppRuntimeStatus(record *core.Record) string {
	runtimeStatus := strings.ToLower(strings.TrimSpace(record.GetString("runtime_status")))
	if runtimeStatus != "" {
		return runtimeStatus
	}
	switch strings.ToLower(strings.TrimSpace(record.GetString("lifecycle_state"))) {
	case "running_healthy", "running_degraded":
		return "running"
	case "stopped", "retired":
		return "stopped"
	case "attention_required":
		return "error"
	default:
		return "unknown"
	}
}

func appDisplayName(record *core.Record) string {
	if value := strings.TrimSpace(record.GetString("name")); value != "" {
		return value
	}
	return strings.TrimSpace(record.Id)
}
