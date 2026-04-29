package status

import (
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor/status/store"
)

func ProjectPlatformLatestStatus(app core.App, now time.Time, targetID, displayName, signalSource, status, reason string, summary map[string]any) error {
	failures, lastSuccessAt, lastFailureAt := SingleObservationFailureState(status, "healthy", now)
	_, err := store.UpsertLatestStatus(app, store.LatestStatusUpsert{
		TargetType:              "platform",
		TargetID:                targetID,
		DisplayName:             displayName,
		Status:                  status,
		Reason:                  reason,
		SignalSource:            signalSource,
		LastTransitionAt:        now,
		LastSuccessAt:           lastSuccessAt,
		LastFailureAt:           lastFailureAt,
		LastReportedAt:          &now,
		ConsecutiveFailures:     &failures,
		Summary:                 summary,
		PreserveStrongerFailure: false,
	})
	return err
}
