package store

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/infra/collections"
)

func PreviousFailureCount(app core.App, targetType string, targetID string) int {
	record, err := app.FindFirstRecordByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": strings.TrimSpace(targetType), "targetID": strings.TrimSpace(targetID)},
	)
	if err != nil {
		return 0
	}
	return record.GetInt("consecutive_failures")
}

func HasDifferentCheckKind(app core.App, targetType, targetID, checkKind string) bool {
	record, err := app.FindFirstRecordByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": strings.TrimSpace(targetType), "targetID": strings.TrimSpace(targetID)},
	)
	if err != nil {
		return false
	}
	summary, summaryErr := SummaryFromRecord(record)
	if summaryErr != nil {
		return false
	}
	existingCheckKind := strings.TrimSpace(fmt.Sprint(summary["check_kind"]))
	return existingCheckKind != "" && !strings.EqualFold(existingCheckKind, strings.TrimSpace(checkKind))
}
