package status

import (
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor/persistence"
	"github.com/websoft9/appos/backend/domain/resource/instances"
)

func LoadResourceCheckSummary(app core.App, targetType, targetID, checkKind, registryEntryID, resourceKind, templateID, endpoint string) map[string]any {
	return persistence.LoadResourceCheckSummary(app, targetType, targetID, checkKind, registryEntryID, resourceKind, templateID, endpoint)
}

func ApplyReasonCode(summary map[string]any, reasonCode string) {
	persistence.ApplyReasonCode(summary, reasonCode)
}

func ProjectResourceCheckLatestStatus(app core.App, targetType, targetID, displayName, signalSource, checkKind string, status string, reason string, summary map[string]any, statusPriorityMap map[string]int, now time.Time) error {
	failures, lastSuccessAt, lastFailureAt := ResourceCheckFailureState(app, targetType, targetID, status, now)

	_, err := persistence.UpsertLatestStatus(app, persistence.LatestStatusUpsert{
		TargetType:              targetType,
		TargetID:                targetID,
		DisplayName:             displayName,
		Status:                  strings.TrimSpace(status),
		Reason:                  strings.TrimSpace(reason),
		SignalSource:            signalSource,
		LastTransitionAt:        now,
		LastSuccessAt:           lastSuccessAt,
		LastFailureAt:           lastFailureAt,
		LastCheckedAt:           &now,
		ConsecutiveFailures:     &failures,
		Summary:                 summary,
		StatusPriorityMap:       statusPriorityMap,
		PreserveStrongerFailure: PreserveStrongerFailureFromOtherCheck(app, targetType, targetID, checkKind),
	})
	return err
}

func ResourceCheckFailureState(app core.App, targetType, targetID, status string, now time.Time) (int, *time.Time, *time.Time) {
        return FailureStateFromPrevious(persistence.PreviousFailureCount(app, targetType, targetID), status, "healthy", now)
}

func PreserveStrongerFailureFromOtherCheck(app core.App, targetType, targetID, checkKind string) bool {
	return persistence.HasDifferentCheckKind(app, targetType, targetID, checkKind)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func ResourceDisplayName(item *instances.Instance) string {
	return firstNonEmpty(item.Name(), item.ID())
}
