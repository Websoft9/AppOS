package feeds

import (
	"context"
	"fmt"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type PollSummary struct {
	ProcessedSources int
	DueSources       int
	FailedSources    int
	CreatedItems     int
	UpdatedItems     int
}

func PollDueSources(ctx context.Context, app core.App, client HTTPDoer, now time.Time) (PollSummary, error) {
	return PollSources(ctx, app, client, now, false)
}

func PollSource(ctx context.Context, app core.App, client HTTPDoer, now time.Time, sourceRecord *core.Record, force bool) (PollSummary, error) {
	if sourceRecord == nil {
		return PollSummary{}, fmt.Errorf("feed source record is required")
	}

	return pollSourceRecord(ctx, app, client, now, sourceRecord, force)
}

func PollSources(ctx context.Context, app core.App, client HTTPDoer, now time.Time, force bool) (PollSummary, error) {
	sourceRecords, err := app.FindAllRecords(CollectionSources)
	if err != nil {
		return PollSummary{}, err
	}

	summary := PollSummary{}
	for _, sourceRecord := range sourceRecords {
		source := FromRecord(sourceRecord)
		snapshot := source.Snapshot()
		if force {
			if snapshot.Status != StatusActive {
				continue
			}
		} else if !source.Due(now) {
			continue
		}

		result, pollErr := pollSourceRecord(ctx, app, client, now, sourceRecord, force)
		if pollErr != nil {
			return summary, pollErr
		}
		summary.ProcessedSources += result.ProcessedSources
		summary.DueSources += result.DueSources
		summary.FailedSources += result.FailedSources
		summary.CreatedItems += result.CreatedItems
		summary.UpdatedItems += result.UpdatedItems
	}

	return summary, nil
}

func pollSourceRecord(ctx context.Context, app core.App, client HTTPDoer, now time.Time, sourceRecord *core.Record, force bool) (PollSummary, error) {
	summary := PollSummary{ProcessedSources: 1}
	source := FromRecord(sourceRecord)
	snapshot := source.Snapshot()
	if !force && !source.Due(now) {
		return summary, nil
	}
	summary.DueSources = 1

	candidates, fetchErr := FetchAndParseSource(ctx, snapshot, client)
	if fetchErr != nil {
		source.MarkFetchFailure(app, now, fetchErr.Error())
		if saveErr := app.Save(sourceRecord); saveErr != nil {
			return summary, fmt.Errorf("save failed source status: %w", saveErr)
		}
		summary.FailedSources = 1
		return summary, nil
	}

	created, updated, ingestErr := UpsertSourceItems(app, sourceRecord, candidates)
	if ingestErr != nil {
		source.MarkFetchFailure(app, now, ingestErr.Error())
		if saveErr := app.Save(sourceRecord); saveErr != nil {
			return summary, fmt.Errorf("save failed source status: %w", saveErr)
		}
		summary.FailedSources = 1
		return summary, nil
	}

	source.MarkFetchSuccess(app, now)
	if saveErr := app.Save(sourceRecord); saveErr != nil {
		return summary, fmt.Errorf("save successful source status: %w", saveErr)
	}
	if err := RefreshSourceItemCount(app, sourceRecord.Id); err != nil {
		return summary, fmt.Errorf("refresh source item count: %w", err)
	}
	summary.CreatedItems = created
	summary.UpdatedItems = updated
	return summary, nil
}

func UpsertSourceItems(app core.App, sourceRecord *core.Record, candidates []ItemCandidate) (int, int, error) {
	itemsCol, err := app.FindCollectionByNameOrId(CollectionItems)
	if err != nil {
		return 0, 0, err
	}

	created := 0
	updated := 0
	for _, candidate := range candidates {
		candidate.Keywords = ExtractKeywords(candidate.Title, candidate.Summary)
		candidate.Tags = ExtractTags(candidate.Keywords)
		normalized := NormalizeItem(candidate)

		existingRecords, err := app.FindRecordsByFilter(
			CollectionItems,
			"source_id = {:source_id} && external_id = {:external_id}",
			"",
			1,
			0,
			dbx.Params{"source_id": sourceRecord.Id, "external_id": normalized.ExternalID},
		)
		if err != nil {
			return created, updated, err
		}

		var record *core.Record
		if len(existingRecords) > 0 {
			record = existingRecords[0]
			updated++
		} else {
			record = core.NewRecord(itemsCol)
			record.Set("source_id", sourceRecord.Id)
			created++
		}

		record.Set("external_id", normalized.ExternalID)
		record.Set("origin_type", normalized.OriginType)
		record.Set("title", normalized.Title)
		record.Set("link", normalized.Link)
		record.Set("summary", normalized.Summary)
		record.Set("content_raw", normalized.ContentRaw)
		record.Set("keywords_json", normalized.Keywords)
		record.Set("tags_json", normalized.Tags)
		record.Set("read_state", PreserveItemReadState(record, normalized))
		record.Set("is_starred", PreserveItemStarred(record, normalized))
		if normalized.PublishedAt.IsZero() {
			record.Set("published_at", nil)
		} else {
			record.Set("published_at", mustDateTime(normalized.PublishedAt))
		}

		if err := app.Save(record); err != nil {
			return created, updated, err
		}
	}

	return created, updated, nil
}
