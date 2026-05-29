package feeds

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func newSourceRecord() *core.Record {
	rec := core.NewRecord(core.NewBaseCollection(CollectionSources))
	rec.Set("name", " AppOS Feed ")
	rec.Set("url", " https://example.com/feed.xml ")
	rec.Set("format", FormatRSS)
	rec.Set("status", StatusActive)
	rec.Set("failure_streak", 0)
	return rec
}

func TestSnapshotFromRecordTrimsAndParsesFields(t *testing.T) {
	rec := newSourceRecord()
	now := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	rec.Set("last_fetched_at", mustDateTime(now))
	rec.Set("next_poll_at", mustDateTime(now.Add(15*time.Minute)))
	rec.Set("failure_streak", 2)
	rec.Set("last_success_at", mustDateTime(now.Add(-time.Minute)))
	rec.Set("last_error", "  timeout  ")

	snapshot := SnapshotFromRecord(rec)
	if snapshot.Name != "AppOS Feed" {
		t.Fatalf("expected trimmed name, got %q", snapshot.Name)
	}
	if snapshot.URL != "https://example.com/feed.xml" {
		t.Fatalf("expected trimmed url, got %q", snapshot.URL)
	}
	if snapshot.LastFetchedAt != now {
		t.Fatalf("expected parsed last_fetched_at %v, got %v", now, snapshot.LastFetchedAt)
	}
	if snapshot.NextPollAt != now.Add(15*time.Minute) {
		t.Fatalf("expected parsed next_poll_at, got %v", snapshot.NextPollAt)
	}
	if snapshot.FailureStreak != 2 {
		t.Fatalf("expected failure streak 2, got %d", snapshot.FailureStreak)
	}
	if snapshot.LastSuccessAt != now.Add(-time.Minute) {
		t.Fatalf("expected parsed last_success_at, got %v", snapshot.LastSuccessAt)
	}
	if snapshot.LastError != "timeout" {
		t.Fatalf("expected trimmed last_error, got %q", snapshot.LastError)
	}
}

func TestSourceDueRespectsStatusAndNextPollAt(t *testing.T) {
	now := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)

	newSource := FromRecord(newSourceRecord())
	if !newSource.Due(now) {
		t.Fatal("expected active source with empty next_poll_at to be due")
	}

	notDueRec := newSourceRecord()
	notDueRec.Set("next_poll_at", mustDateTime(now.Add(30*time.Minute)))
	if FromRecord(notDueRec).Due(now) {
		t.Fatal("expected source with future next_poll_at to not be due")
	}

	pausedRec := newSourceRecord()
	pausedRec.Set("status", StatusPaused)
	if FromRecord(pausedRec).Due(now) {
		t.Fatal("expected paused source to never be due")
	}

	archivedRec := newSourceRecord()
	archivedRec.Set("status", StatusArchived)
	if FromRecord(archivedRec).Due(now) {
		t.Fatal("expected archived source to never be due")
	}

	dueRec := newSourceRecord()
	dueRec.Set("next_poll_at", mustDateTime(now.Add(-time.Minute)))
	if !FromRecord(dueRec).Due(now) {
		t.Fatal("expected source with past next_poll_at to be due")
	}
}

func TestSourceMarkFetchSuccessAndFailure(t *testing.T) {
	now := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	app := newFeedsTestApp(t)
	rec := newSourceRecord()
	source := FromRecord(rec)

	source.MarkFetchFailure(app, now, "  "+strings.Repeat("x", maxLastErrorLen+5)+"  ")
	if got := recordDateTime(rec, "last_fetched_at"); got != now {
		t.Fatalf("expected failure to set last_fetched_at, got %v", got)
	}
	if got := rec.GetInt("failure_streak"); got != 1 {
		t.Fatalf("expected failure to increment failure_streak to 1, got %d", got)
	}
	if got := recordDateTime(rec, "next_poll_at"); got != now.Add(2*time.Hour) {
		t.Fatalf("expected first failure backoff to 2h, got %v", got)
	}
	if got := rec.GetString("last_error"); len(got) != maxLastErrorLen {
		t.Fatalf("expected truncated last_error length %d, got %d", maxLastErrorLen, len(got))
	}
	if got := recordDateTime(rec, "last_success_at"); !got.IsZero() {
		t.Fatalf("expected failure not to set last_success_at, got %v", got)
	}

	source.MarkFetchFailure(app, now.Add(time.Minute), "again")
	if got := rec.GetInt("failure_streak"); got != 2 {
		t.Fatalf("expected second failure to increment failure_streak to 2, got %d", got)
	}
	if got := recordDateTime(rec, "next_poll_at"); got != now.Add(time.Minute).Add(6*time.Hour) {
		t.Fatalf("expected second failure backoff to 6h, got %v", got)
	}

	source.MarkFetchSuccess(app, now.Add(time.Minute))
	if got := recordDateTime(rec, "last_fetched_at"); got != now.Add(time.Minute) {
		t.Fatalf("expected success to refresh last_fetched_at, got %v", got)
	}
	if got := recordDateTime(rec, "last_success_at"); got != now.Add(time.Minute) {
		t.Fatalf("expected success to set last_success_at, got %v", got)
	}
	if got := rec.GetString("last_error"); got != "" {
		t.Fatalf("expected success to clear last_error, got %q", got)
	}
	if got := rec.GetInt("failure_streak"); got != 0 {
		t.Fatalf("expected success to reset failure_streak, got %d", got)
	}
	if got := recordDateTime(rec, "next_poll_at"); got != now.Add(time.Minute).Add(3*time.Hour) {
		t.Fatalf("expected success to schedule next poll in 3h, got %v", got)
	}
}

func TestPollSourceNowLoadsSourceAndForces(t *testing.T) {
	app := newFeedsTestApp(t)
	col, err := app.FindCollectionByNameOrId(CollectionSources)
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", "Vendor feed")
	rec.Set("url", "https://example.com/feed.xml")
	rec.Set("format", FormatRSS)
	rec.Set("status", StatusActive)
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}

	called := false
	summary, err := PollSourceNow(context.Background(), app, nil, time.Date(2026, 5, 29, 12, 0, 0, 0, time.UTC), rec.Id, func(_ context.Context, _ core.App, _ HTTPDoer, _ time.Time, record *core.Record, force bool) (PollSummary, error) {
		called = true
		if record.Id != rec.Id {
			t.Fatalf("expected source %q, got %q", rec.Id, record.Id)
		}
		if !force {
			t.Fatal("expected service poll to force source execution")
		}
		return PollSummary{ProcessedSources: 1, DueSources: 1, CreatedItems: 2}, nil
	})
	if err != nil {
		t.Fatalf("poll source now: %v", err)
	}
	if !called {
		t.Fatal("expected poll function to be called")
	}
	if summary.CreatedItems != 2 {
		t.Fatalf("expected created items 2, got %#v", summary)
	}
}

func TestPollSourceNowRejectsInactiveSource(t *testing.T) {
	app := newFeedsTestApp(t)
	col, err := app.FindCollectionByNameOrId(CollectionSources)
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", "Paused feed")
	rec.Set("url", "https://example.com/feed.xml")
	rec.Set("format", FormatRSS)
	rec.Set("status", StatusPaused)
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}

	_, err = PollSourceNow(context.Background(), app, nil, time.Date(2026, 5, 29, 12, 0, 0, 0, time.UTC), rec.Id, nil)
	var validationErr *SourceValidationError
	if err == nil || !strings.Contains(err.Error(), "active") || !errors.As(err, &validationErr) {
		t.Fatalf("expected inactive source validation error, got %v", err)
	}
}