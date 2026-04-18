package persistence

import (
	"encoding/json"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/infra/collections"
)

func summaryFromAny(value any) (map[string]any, error) {
	if value == nil {
		return nil, nil
	}
	if summary, ok := value.(map[string]any); ok {
		return summary, nil
	}
	var raw []byte
	switch typed := value.(type) {
	case []byte:
		raw = typed
	case string:
		raw = []byte(typed)
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return nil, err
		}
		raw = encoded
	}
	var summary map[string]any
	if err := json.Unmarshal(raw, &summary); err != nil {
		return nil, err
	}
	return summary, nil
}

func mustSummaryFromAny(value any) map[string]any {
	summary, err := summaryFromAny(value)
	if err != nil || summary == nil {
		return nil
	}
	return summary
}

func CloneSummary(summary map[string]any) map[string]any {
	if len(summary) == 0 {
		return map[string]any{}
	}
	cloned := make(map[string]any, len(summary))
	for key, value := range summary {
		cloned[key] = value
	}
	return cloned
}

func ApplyReasonCode(summary map[string]any, reasonCode string) {
	if summary == nil {
		return
	}
	trimmed := strings.TrimSpace(strings.ToLower(reasonCode))
	if trimmed == "" {
		delete(summary, "reason_code")
		return
	}
	summary["reason_code"] = trimmed
}

func LoadExistingSummary(app core.App, targetType, targetID string) map[string]any {
	record, err := app.FindFirstRecordByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": strings.TrimSpace(targetType), "targetID": strings.TrimSpace(targetID)},
	)
	if err != nil {
		return map[string]any{}
	}
	return CloneSummary(mustSummaryFromAny(record.Get("summary_json")))
}

func SummaryFromRecord(record *core.Record) (map[string]any, error) {
	if record == nil {
		return map[string]any{}, nil
	}
	summary, err := summaryFromAny(record.Get("summary_json"))
	if err != nil {
		return nil, err
	}
	return CloneSummary(summary), nil
}
