package status

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/monitor/status/store"
)

func ApplySignalEvent(app core.App, event monitor.CanonicalSignalEvent) error {
	_, err := store.UpsertLatestStatus(app, store.LatestStatusUpsert{
		TargetType:              event.TargetType,
		TargetID:                event.TargetID,
		DisplayName:             event.DisplayName,
		Status:                  event.Status,
		Reason:                  event.Reason,
		SignalSource:            event.SignalSource,
		LastTransitionAt:        event.ObservedAt,
		LastSuccessAt:           event.LastSuccessAt,
		LastFailureAt:           event.LastFailureAt,
		LastCheckedAt:           event.LastCheckedAt,
		LastReportedAt:          event.LastReportedAt,
		ConsecutiveFailures:     event.ConsecutiveFailures,
		Summary:                 event.Summary,
		StatusPriorityMap:       event.StatusPriorityMap,
		PreserveStrongerFailure: event.PreserveStrongerFailure,
	})
	return err
}

func LoadExistingSummary(app core.App, targetType, targetID string) map[string]any {
	return store.LoadExistingSummary(app, targetType, targetID)
}
