package status

import (
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/monitor/status/store"
	"github.com/websoft9/appos/backend/infra/collections"
)

func EvaluateHeartbeat(targetEntry monitor.TargetRegistryEntry, observedAt, now time.Time) HeartbeatProjection {
	age := now.Sub(observedAt)
	if age < 0 {
		age = 0
	}
	switch {
	case age > monitor.OfflineHeartbeatThreshold:
		return HeartbeatProjection{
			Status:         targetEntry.HeartbeatStatusFor(monitor.HeartbeatStateOffline),
			Reason:         targetEntry.HeartbeatReasonFor(monitor.HeartbeatStateOffline, ""),
			ReasonCode:     targetEntry.HeartbeatReasonCodeFor(monitor.HeartbeatStateOffline, ""),
			HeartbeatState: monitor.HeartbeatStateOffline,
			ObservedAt:     observedAt,
		}
	case age > monitor.StaleHeartbeatThreshold:
		return HeartbeatProjection{
			Status:         targetEntry.HeartbeatStatusFor(monitor.HeartbeatStateStale),
			Reason:         targetEntry.HeartbeatReasonFor(monitor.HeartbeatStateStale, ""),
			ReasonCode:     targetEntry.HeartbeatReasonCodeFor(monitor.HeartbeatStateStale, ""),
			HeartbeatState: monitor.HeartbeatStateStale,
			ObservedAt:     observedAt,
		}
	default:
		return HeartbeatProjection{
			Status:         targetEntry.HeartbeatStatusFor(monitor.HeartbeatStateFresh),
			Reason:         "",
			ReasonCode:     targetEntry.HeartbeatReasonCodeFor(monitor.HeartbeatStateFresh, ""),
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
		0,
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
		projection := EvaluateHeartbeat(serverEntry, observedAt, now)
		if monitor.IsStrongerFailure(record.GetString("status"), projection.Status, serverEntry.StatusPriority) {
			continue
		}
		summary, err := store.SummaryFromRecord(record)
		if err != nil {
			return err
		}
		if summary == nil {
			summary = map[string]any{}
		}
		summary["heartbeat_state"] = projection.HeartbeatState
		store.ApplyReasonCode(summary, projection.ReasonCode)

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
		_, err = store.UpsertLatestStatus(app, store.LatestStatusUpsert{
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
