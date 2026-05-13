package store

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/infra/collections"
)

type LatestStatusUpsert struct {
	TargetType              string
	TargetID                string
	DisplayName             string
	Status                  string
	Reason                  string
	SignalSource            string
	LastTransitionAt        time.Time
	LastSuccessAt           *time.Time
	LastFailureAt           *time.Time
	LastCheckedAt           *time.Time
	LastReportedAt          *time.Time
	ConsecutiveFailures     *int
	Summary                 map[string]any
	StatusPriorityMap       map[string]int
	PreserveStrongerFailure bool
	// IncomingCheckKind, when non-empty, derives PreserveStrongerFailure atomically
	// from the already-loaded record: preservation is enabled only when the existing
	// record's check_kind in summary_json differs from this value. This eliminates
	// the separate HasDifferentCheckKind DB round-trip and the associated TOCTOU gap.
	IncomingCheckKind string
}

func UpsertLatestStatus(app core.App, input LatestStatusUpsert) (*core.Record, error) {
	col, err := app.FindCollectionByNameOrId(collections.MonitorLatestStatus)
	if err != nil {
		return nil, err
	}

	record, err := app.FindFirstRecordByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": input.TargetType, "targetID": input.TargetID},
	)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		record = core.NewRecord(col)
	}

	existingStatus := record.GetString("status")

	// When IncomingCheckKind is set, compute PreserveStrongerFailure from the record
	// we already hold—no extra DB query, no TOCTOU window.
	if input.IncomingCheckKind != "" {
		existingCheckKind := ""
		if existingSummary, summaryErr := SummaryFromRecord(record); summaryErr == nil && existingSummary != nil {
			if checkKind, ok := existingSummary["check_kind"].(string); ok {
				existingCheckKind = strings.TrimSpace(checkKind)
			}
		}
		input.PreserveStrongerFailure = existingCheckKind != "" &&
			!strings.EqualFold(existingCheckKind, strings.TrimSpace(input.IncomingCheckKind))
	}

	if input.PreserveStrongerFailure && monitor.IsStrongerFailure(existingStatus, input.Status, input.StatusPriorityMap) {
		input.Status = existingStatus
		input.Reason = record.GetString("reason")
	}

	lastTransitionAt := input.LastTransitionAt
	if existingStatus != "" && existingStatus == input.Status {
		if value := record.GetDateTime("last_transition_at"); !value.IsZero() {
			lastTransitionAt = value.Time()
		}
	}

	record.Set("target_type", input.TargetType)
	record.Set("target_id", input.TargetID)
	record.Set("display_name", input.DisplayName)
	record.Set("status", input.Status)
	record.Set("reason", input.Reason)
	record.Set("signal_source", input.SignalSource)
	record.Set("last_transition_at", lastTransitionAt.UTC().Format(time.RFC3339))
	if input.LastSuccessAt != nil {
		record.Set("last_success_at", input.LastSuccessAt.UTC().Format(time.RFC3339))
	}
	if input.LastFailureAt != nil {
		record.Set("last_failure_at", input.LastFailureAt.UTC().Format(time.RFC3339))
	}
	if input.LastCheckedAt != nil {
		record.Set("last_checked_at", input.LastCheckedAt.UTC().Format(time.RFC3339))
	}
	if input.LastReportedAt != nil {
		record.Set("last_reported_at", input.LastReportedAt.UTC().Format(time.RFC3339))
	}
	if input.ConsecutiveFailures != nil {
		record.Set("consecutive_failures", *input.ConsecutiveFailures)
	}
	if input.Summary != nil {
		record.Set("summary_json", input.Summary)
	}

	if err := app.Save(record); err != nil {
		return nil, err
	}
	return record, nil
}
