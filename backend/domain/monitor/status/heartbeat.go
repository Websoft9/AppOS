package status

import (
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/monitor/persistence"
	"github.com/websoft9/appos/backend/infra/collections"
)

func EvaluateHeartbeat(observedAt, now time.Time) HeartbeatProjection {
	serverEntry, ok, err := monitor.ResolveTargetRegistryEntry(monitor.TargetTypeServer, "", "")
	if err != nil || !ok {
		serverEntry = monitor.TargetRegistryEntry{}
	}
	age := now.Sub(observedAt)
	if age < 0 {
		age = 0
	}
	switch {
	case age > monitor.OfflineHeartbeatThreshold:
		return HeartbeatProjection{
			Status:         serverEntry.HeartbeatStatusFor(monitor.HeartbeatStateOffline),
			Reason:         serverEntry.HeartbeatReasonFor(monitor.HeartbeatStateOffline, ""),
			ReasonCode:     serverEntry.HeartbeatReasonCodeFor(monitor.HeartbeatStateOffline, ""),
			HeartbeatState: monitor.HeartbeatStateOffline,
			ObservedAt:     observedAt,
		}
	case age > monitor.StaleHeartbeatThreshold:
		return HeartbeatProjection{
			Status:         serverEntry.HeartbeatStatusFor(monitor.HeartbeatStateStale),
			Reason:         serverEntry.HeartbeatReasonFor(monitor.HeartbeatStateStale, ""),
			ReasonCode:     serverEntry.HeartbeatReasonCodeFor(monitor.HeartbeatStateStale, ""),
			HeartbeatState: monitor.HeartbeatStateStale,
			ObservedAt:     observedAt,
		}
	default:
		return HeartbeatProjection{
			Status:         serverEntry.HeartbeatStatusFor(monitor.HeartbeatStateFresh),
			Reason:         "",
			ReasonCode:     serverEntry.HeartbeatReasonCodeFor(monitor.HeartbeatStateFresh, ""),
			HeartbeatState: monitor.HeartbeatStateFresh,
			ObservedAt:     observedAt,
		}
	}
}

func RefreshHeartbeatFreshness(app core.App, now time.Time) error {
	serverEntry, ok, err := monitor.ResolveTargetRegistryEntry(monitor.TargetTypeServer, "", "")
	if err != nil || !ok {
		serverEntry = monitor.TargetRegistryEntry{}
	}
	records, err := app.FindRecordsByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && signal_source = {:signalSource}",
		"",
		500,
		0,
		map[string]any{"targetType": monitor.TargetTypeServer, "signalSource": monitor.SignalSourceAgent},
	)
	if err != nil {
		return err
	}
	for _, record := range records {
		value := record.GetDateTime("last_reported_at")
		if value.IsZero() {
			continue
		}
		observedAt := value.Time()
		projection := EvaluateHeartbeat(observedAt, now)
		if monitor.IsStrongerFailure(record.GetString("status"), projection.Status, serverEntry.StatusPriority) {
			continue
		}
		summary, err := persistence.SummaryFromRecord(record)
		if err != nil {
			return err
		}
		if summary == nil {
			summary = map[string]any{}
		}
		summary["heartbeat_state"] = projection.HeartbeatState
		persistence.ApplyReasonCode(summary, projection.ReasonCode)

		failures := record.GetInt("consecutive_failures")
		lastFailureAt := (*time.Time)(nil)
		lastSuccessAt := (*time.Time)(nil)
		if projection.Status == monitor.StatusHealthy {
			failures = 0
			lastSuccessAt = &observedAt
		} else {
			failures++
			nowUTC := now.UTC()
			lastFailureAt = &nowUTC
		}
		_, err = persistence.UpsertLatestStatus(app, persistence.LatestStatusUpsert{
			TargetType:              record.GetString("target_type"),
			TargetID:                record.GetString("target_id"),
			DisplayName:             record.GetString("display_name"),
			Status:                  projection.Status,
			Reason:                  projection.Reason,
			SignalSource:            record.GetString("signal_source"),
			LastTransitionAt:        now,
			LastSuccessAt:           lastSuccessAt,
			LastFailureAt:           lastFailureAt,
			LastReportedAt:          &observedAt,
			ConsecutiveFailures:     &failures,
			Summary:                 summary,
			StatusPriorityMap:       serverEntry.StatusPriority,
			PreserveStrongerFailure: true,
		})
		if err != nil {
			return err
		}
	}
	return nil
}

type HeartbeatProjection struct {
	Status         string
	Reason         string
	ReasonCode     string
	HeartbeatState string
	ObservedAt     time.Time
}
