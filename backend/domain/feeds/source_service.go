package feeds

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const (
	SourceConflictCodeExists         = "feed_source_exists"
	SourceConflictCodeIdentityLocked = "feed_source_identity_locked"
)

type SourceUpsertInput struct {
	Name       string
	URL        string
	FaviconURL string
	Format     string
	Status     string
}

type SourceValidationError struct {
	Message string
}

func (e *SourceValidationError) Error() string {
	if e == nil {
		return "invalid feed source"
	}
	return e.Message
}

type SourceConflictError struct {
	Code    string
	Message string
	Cause   error
}

func (e *SourceConflictError) Error() string {
	if e == nil {
		return "feed source conflict"
	}
	return e.Message
}

func (e *SourceConflictError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

type SourceNotFoundError struct {
	SourceID string
}

func (e *SourceNotFoundError) Error() string {
	if e == nil || strings.TrimSpace(e.SourceID) == "" {
		return "feed source not found"
	}
	return fmt.Sprintf("feed source %s not found", e.SourceID)
}

func NormalizeSourceUpsertInput(input SourceUpsertInput) (SourceUpsertInput, error) {
	normalized := SourceUpsertInput{
		Name:       strings.TrimSpace(input.Name),
		URL:        strings.TrimSpace(input.URL),
		FaviconURL: strings.TrimSpace(input.FaviconURL),
		Format:     strings.TrimSpace(input.Format),
		Status:     strings.TrimSpace(input.Status),
	}

	if normalized.Name == "" {
		return normalized, &SourceValidationError{Message: "feed source name is required"}
	}
	if normalized.URL == "" {
		return normalized, &SourceValidationError{Message: "feed source url is required"}
	}
	if normalized.Format != FormatRSS && normalized.Format != FormatAtom {
		return normalized, &SourceValidationError{Message: "invalid feed source format"}
	}
	switch normalized.Status {
	case StatusActive, StatusPaused, StatusArchived:
	default:
		return normalized, &SourceValidationError{Message: "invalid feed source status"}
	}

	return normalized, nil
}

func ListSources(app core.App) ([]*core.Record, error) {
	records, err := app.FindRecordsByFilter(CollectionSources, "", "-updated", 500, 0, nil)
	if err != nil {
		return nil, fmt.Errorf("list feed sources: %w", err)
	}
	return records, nil
}

func DeleteSourceArticles(app core.App, sourceID string, count int) (SourceDeleteResult, error) {
	trimmedSourceID := strings.TrimSpace(sourceID)
	if trimmedSourceID == "" {
		return SourceDeleteResult{}, &SourceValidationError{Message: "feed source id is required"}
	}
	if count <= 0 {
		return SourceDeleteResult{}, &SourceValidationError{Message: "delete count must be greater than zero"}
	}

	if _, err := loadSourceRecord(app, trimmedSourceID); err != nil {
		return SourceDeleteResult{}, err
	}

	result, err := DeleteSourceItems(app, trimmedSourceID, count)
	if err != nil {
		return SourceDeleteResult{}, fmt.Errorf("delete source feed articles: %w", err)
	}

	return result, nil
}

func PollSourceNow(ctx context.Context, app core.App, client HTTPDoer, now time.Time, sourceID string, pollFn func(context.Context, core.App, HTTPDoer, time.Time, *core.Record, bool) (PollSummary, error)) (PollSummary, error) {
	trimmedSourceID := strings.TrimSpace(sourceID)
	if trimmedSourceID == "" {
		return PollSummary{}, &SourceValidationError{Message: "feed source id is required"}
	}

	record, err := loadSourceRecord(app, trimmedSourceID)
	if err != nil {
		return PollSummary{}, err
	}
	if strings.TrimSpace(record.GetString("status")) != StatusActive {
		return PollSummary{}, &SourceValidationError{Message: "feed source must be active to pull now"}
	}
	if pollFn == nil {
		pollFn = PollSource
	}

	summary, err := pollFn(ctx, app, client, now, record, true)
	if err != nil {
		return PollSummary{}, fmt.Errorf("poll feed source now: %w", err)
	}

	return summary, nil
}

func CreateSource(app core.App, input SourceUpsertInput) (*core.Record, error) {
	normalized, err := NormalizeSourceUpsertInput(input)
	if err != nil {
		return nil, err
	}

	col, err := app.FindCollectionByNameOrId(CollectionSources)
	if err != nil {
		return nil, fmt.Errorf("resolve feed sources collection: %w", err)
	}

	record := core.NewRecord(col)
	FromRecord(record).ApplyConfiguration(normalized)
	if err := saveSourceRecord(app, record); err != nil {
		return nil, err
	}

	return record, nil
}

func UpdateSource(app core.App, sourceID string, input SourceUpsertInput) (*core.Record, error) {
	trimmedSourceID := strings.TrimSpace(sourceID)
	if trimmedSourceID == "" {
		return nil, &SourceValidationError{Message: "feed source id is required"}
	}

	normalized, err := NormalizeSourceUpsertInput(input)
	if err != nil {
		return nil, err
	}

	record, err := app.FindRecordById(CollectionSources, trimmedSourceID)
	if err != nil {
		return nil, &SourceNotFoundError{SourceID: trimmedSourceID}
	}

	snapshot := FromRecord(record).Snapshot()
	identityChanged := snapshot.URL != normalized.URL || snapshot.Format != normalized.Format
	if identityChanged {
		return nil, &SourceConflictError{
			Code:    SourceConflictCodeIdentityLocked,
			Message: "feed source url and format are immutable; create a new source instead",
		}
	}

	FromRecord(record).ApplyConfiguration(normalized)
	if err := saveSourceRecord(app, record); err != nil {
		return nil, err
	}

	return record, nil
}

func DeleteSource(app core.App, sourceID string) error {
	trimmedSourceID := strings.TrimSpace(sourceID)
	if trimmedSourceID == "" {
		return &SourceValidationError{Message: "feed source id is required"}
	}

	record, err := loadSourceRecord(app, trimmedSourceID)
	if err != nil {
		return err
	}
	if err := app.Delete(record); err != nil {
		return fmt.Errorf("delete feed source: %w", err)
	}

	return nil
}

func loadSourceRecord(app core.App, sourceID string) (*core.Record, error) {
	record, err := app.FindRecordById(CollectionSources, sourceID)
	if err != nil {
		return nil, &SourceNotFoundError{SourceID: sourceID}
	}
	return record, nil
}

func saveSourceRecord(app core.App, record *core.Record) error {
	if err := app.Save(record); err != nil {
		if isSourceURLConflict(err) {
			return &SourceConflictError{
				Code:    SourceConflictCodeExists,
				Message: "feed source url already exists",
				Cause:   err,
			}
		}
		return fmt.Errorf("save feed source: %w", err)
	}

	return nil
}

func isSourceURLConflict(err error) bool {
	if err == nil {
		return false
	}
	normalized := strings.ToLower(err.Error())
	return strings.Contains(normalized, "feed_sources.url") ||
		strings.Contains(normalized, "idx_feed_sources_url") ||
		(strings.Contains(normalized, "unique") && strings.Contains(normalized, "url"))
}
