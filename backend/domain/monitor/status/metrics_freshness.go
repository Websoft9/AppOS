package status

import (
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/monitor/status/store"
)

type MetricsFreshnessProjection struct {
	Status     string
	Reason     string
	ReasonCode string
	State      string
	ObservedAt time.Time
}

func EvaluateMetricsFreshness(observedAt time.Time, hasSample bool, now time.Time) MetricsFreshnessProjection {
	if !hasSample || observedAt.IsZero() {
		return MetricsFreshnessProjection{
			Status:     monitor.StatusUnknown,
			Reason:     "metrics missing",
			ReasonCode: "metrics_missing",
			State:      monitor.MetricsFreshnessMissing,
		}
	}
	now = now.UTC()
	observedAt = observedAt.UTC()
	age := now.Sub(observedAt)
	if age < 0 {
		age = 0
	}
	if age > monitor.MetricsMissingThreshold {
		return MetricsFreshnessProjection{
			Status:     monitor.StatusUnknown,
			Reason:     "metrics missing",
			ReasonCode: "metrics_missing",
			State:      monitor.MetricsFreshnessMissing,
			ObservedAt: observedAt,
		}
	}
	if age > monitor.MetricsStaleThreshold {
		return MetricsFreshnessProjection{
			Status:     monitor.StatusUnknown,
			Reason:     "metrics stale",
			ReasonCode: "metrics_stale",
			State:      monitor.MetricsFreshnessStale,
			ObservedAt: observedAt,
		}
	}
	return MetricsFreshnessProjection{
		Status:     monitor.StatusHealthy,
		State:      monitor.MetricsFreshnessFresh,
		ObservedAt: observedAt,
	}
}

func MetricsFreshnessUnknown(reason string) MetricsFreshnessProjection {
	trimmed := strings.TrimSpace(reason)
	if trimmed == "" {
		trimmed = "metrics freshness unknown"
	}
	return MetricsFreshnessProjection{
		Status:     monitor.StatusUnknown,
		Reason:     trimmed,
		ReasonCode: "metrics_query_failed",
		State:      monitor.MetricsFreshnessUnknown,
	}
}

func ProjectMetricsFreshnessLatestStatus(app core.App, targetID string, displayName string, projection MetricsFreshnessProjection, now time.Time) error {
	serverEntry, ok, err := monitor.ResolveTargetRegistryEntry(monitor.TargetTypeServer, "", "")
	if err != nil || !ok {
		serverEntry = monitor.TargetRegistryEntry{}
	}
	summary := store.LoadExistingSummary(app, monitor.TargetTypeServer, targetID)
	summary["metrics_freshness_state"] = projection.State
	if projection.ReasonCode != "" {
		summary["metrics_reason_code"] = projection.ReasonCode
	} else {
		delete(summary, "metrics_reason_code")
	}
	if !projection.ObservedAt.IsZero() {
		summary["metrics_observed_at"] = projection.ObservedAt.UTC().Format(time.RFC3339)
	} else {
		delete(summary, "metrics_observed_at")
	}

	lastSuccessAt := (*time.Time)(nil)
	lastFailureAt := (*time.Time)(nil)
	if projection.Status == monitor.StatusHealthy && !projection.ObservedAt.IsZero() {
		observedAt := projection.ObservedAt.UTC()
		lastSuccessAt = &observedAt
	} else if projection.Status != monitor.StatusHealthy {
		nowUTC := now.UTC()
		lastFailureAt = &nowUTC
	}
	lastReportedAt := (*time.Time)(nil)
	if !projection.ObservedAt.IsZero() {
		observedAt := projection.ObservedAt.UTC()
		lastReportedAt = &observedAt
	}
	_, err = store.UpsertLatestStatus(app, store.LatestStatusUpsert{
		TargetType:              monitor.TargetTypeServer,
		TargetID:                targetID,
		DisplayName:             displayName,
		Status:                  projection.Status,
		Reason:                  projection.Reason,
		SignalSource:            monitor.SignalSourceNetdata,
		LastTransitionAt:        now.UTC(),
		LastSuccessAt:           lastSuccessAt,
		LastFailureAt:           lastFailureAt,
		LastReportedAt:          lastReportedAt,
		Summary:                 summary,
		StatusPriorityMap:       serverEntry.StatusPriority,
		PreserveStrongerFailure: true,
	})
	return err
}
