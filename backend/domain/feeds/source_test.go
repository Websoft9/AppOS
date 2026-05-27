package feeds

import (
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
	rec.Set("poll_interval_minutes", 60)
	return rec
}

func TestSnapshotFromRecordTrimsAndParsesFields(t *testing.T) {
	rec := newSourceRecord()
	now := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	rec.Set("last_fetched_at", mustDateTime(now))
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
	if snapshot.LastSuccessAt != now.Add(-time.Minute) {
		t.Fatalf("expected parsed last_success_at, got %v", snapshot.LastSuccessAt)
	}
	if snapshot.LastError != "timeout" {
		t.Fatalf("expected trimmed last_error, got %q", snapshot.LastError)
	}
}

func TestSourceDueRespectsStatusAndPollInterval(t *testing.T) {
	now := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)

	newSource := FromRecord(newSourceRecord())
	if !newSource.Due(now) {
		t.Fatal("expected never-fetched active source to be due")
	}

	notDueRec := newSourceRecord()
	notDueRec.Set("last_fetched_at", mustDateTime(now.Add(-30*time.Minute)))
	if FromRecord(notDueRec).Due(now) {
		t.Fatal("expected source fetched 30 minutes ago with 60 minute interval to not be due")
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
	}

func TestSourceMarkFetchSuccessAndFailure(t *testing.T) {
	now := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	rec := newSourceRecord()
	source := FromRecord(rec)

	source.MarkFetchFailure(now, "  "+strings.Repeat("x", maxLastErrorLen+5)+"  ")
	if got := recordDateTime(rec, "last_fetched_at"); got != now {
		t.Fatalf("expected failure to set last_fetched_at, got %v", got)
	}
	if got := rec.GetString("last_error"); len(got) != maxLastErrorLen {
		t.Fatalf("expected truncated last_error length %d, got %d", maxLastErrorLen, len(got))
	}
	if got := recordDateTime(rec, "last_success_at"); !got.IsZero() {
		t.Fatalf("expected failure not to set last_success_at, got %v", got)
	}

	source.MarkFetchSuccess(now.Add(time.Minute))
	if got := recordDateTime(rec, "last_fetched_at"); got != now.Add(time.Minute) {
		t.Fatalf("expected success to refresh last_fetched_at, got %v", got)
	}
	if got := recordDateTime(rec, "last_success_at"); got != now.Add(time.Minute) {
		t.Fatalf("expected success to set last_success_at, got %v", got)
	}
	if got := rec.GetString("last_error"); got != "" {
		t.Fatalf("expected success to clear last_error, got %q", got)
	}
}