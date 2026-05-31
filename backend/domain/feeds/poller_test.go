package feeds

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
)

func seedFeedSourceRecord(t *testing.T, app core.App, name, rawURL, format, status string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(CollectionSources)
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", name)
	rec.Set("url", rawURL)
	rec.Set("format", format)
	rec.Set("status", status)
	rec.Set("failure_streak", 0)
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func TestPollDueSourcesCreatesItemsAndMarksSuccess(t *testing.T) {
	app := newFeedsTestApp(t)
	seedFeedSourceRecord(t, app, "Vendor feed", "https://example.com/feed.xml", FormatRSS, StatusActive)

	data := readFeedFixture(t, "rss.xml")
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(string(data))), Header: make(http.Header)}, nil
	})}

	now := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	summary, err := PollDueSources(context.Background(), app, client, now)
	if err != nil {
		t.Fatalf("poll due sources: %v", err)
	}
	if summary.DueSources != 1 || summary.CreatedItems != 2 || summary.UpdatedItems != 0 || summary.FailedSources != 0 {
		t.Fatalf("unexpected poll summary: %#v", summary)
	}

	items, err := app.FindAllRecords(CollectionItems)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 feed items, got %d", len(items))
	}
	if items[0].GetString("read_state") != ReadStateUnread {
		t.Fatalf("expected unread read_state, got %q", items[0].GetString("read_state"))
	}
	if items[0].GetString("origin_type") != OriginTypeFeed {
		t.Fatalf("expected feed origin_type, got %q", items[0].GetString("origin_type"))
	}
	if items[0].GetBool("is_starred") {
		t.Fatal("expected newly ingested items to be unstarred")
	}
	if got := items[0].Get("tags_json"); got == nil {
		t.Fatal("expected tags_json to be populated")
	}

	source, err := app.FindFirstRecordByFilter(CollectionSources, "name = {:name}", map[string]any{"name": "Vendor feed"})
	if err != nil {
		t.Fatal(err)
	}
	if source.GetDateTime("last_success_at").IsZero() {
		t.Fatal("expected last_success_at to be set after successful poll")
	}
	if source.GetInt("item_count") != 2 {
		t.Fatalf("expected source item_count to be 2 after poll, got %d", source.GetInt("item_count"))
	}
	if source.GetInt("failure_streak") != 0 {
		t.Fatalf("expected failure_streak reset after success, got %d", source.GetInt("failure_streak"))
	}
	if source.GetDateTime("next_poll_at").IsZero() {
		t.Fatal("expected next_poll_at to be set after successful poll")
	}
	if source.GetString("last_error") != "" {
		t.Fatalf("expected last_error cleared, got %q", source.GetString("last_error"))
	}
}

func TestPollDueSourcesPreservesExistingItemState(t *testing.T) {
	app := newFeedsTestApp(t)
	source := seedFeedSourceRecord(t, app, "Vendor feed", "https://example.com/feed.xml", FormatRSS, StatusActive)

	itemsCol, err := app.FindCollectionByNameOrId(CollectionItems)
	if err != nil {
		t.Fatal(err)
	}
	existing := core.NewRecord(itemsCol)
	existing.Set("source_id", source.Id)
	existing.Set("origin_type", OriginTypeFeed)
	existing.Set("external_id", "release-1")
	existing.Set("title", "Old title")
	existing.Set("link", "https://example.com/old")
	existing.Set("read_state", ReadStateRead)
	existing.Set("is_starred", true)
	if err := app.Save(existing); err != nil {
		t.Fatal(err)
	}

	data := readFeedFixture(t, "rss.xml")
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(string(data))), Header: make(http.Header)}, nil
	})}

	summary, err := PollDueSources(context.Background(), app, client, time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("poll due sources: %v", err)
	}
	if summary.UpdatedItems == 0 {
		t.Fatalf("expected at least one updated item, got %#v", summary)
	}

	stored, err := app.FindFirstRecordByFilter(CollectionItems, "source_id = {:source_id} && external_id = {:external_id}", map[string]any{"source_id": source.Id, "external_id": "release-1"})
	if err != nil {
		t.Fatal(err)
	}
	if stored.GetString("read_state") != ReadStateRead {
		t.Fatalf("expected read state to be preserved, got %q", stored.GetString("read_state"))
	}
	if !stored.GetBool("is_starred") {
		t.Fatal("expected starred preference to be preserved")
	}
	if stored.GetString("title") != "Release 1" {
		t.Fatalf("expected content fields to refresh, got title %q", stored.GetString("title"))
	}
}

func TestPollDueSourcesMarksFailureAndSkipsPausedSources(t *testing.T) {
	app := newFeedsTestApp(t)
	paused := seedFeedSourceRecord(t, app, "Paused feed", "https://example.com/paused.xml", FormatRSS, StatusPaused)
	broken := seedFeedSourceRecord(t, app, "Broken feed", "https://example.com/broken.xml", FormatRSS, StatusActive)

	callCount := 0
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		callCount++
		return &http.Response{StatusCode: http.StatusBadGateway, Body: io.NopCloser(strings.NewReader("bad gateway")), Header: make(http.Header)}, nil
	})}

	summary, err := PollDueSources(context.Background(), app, client, time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("poll due sources: %v", err)
	}
	if summary.DueSources != 1 || summary.FailedSources != 1 {
		t.Fatalf("unexpected poll summary: %#v", summary)
	}
	if callCount != 1 {
		t.Fatalf("expected only active due source to be fetched once, got %d calls", callCount)
	}

	pausedStored, err := app.FindRecordById(CollectionSources, paused.Id)
	if err != nil {
		t.Fatal(err)
	}
	if !pausedStored.GetDateTime("last_fetched_at").IsZero() {
		t.Fatal("expected paused source to remain untouched")
	}

	brokenStored, err := app.FindRecordById(CollectionSources, broken.Id)
	if err != nil {
		t.Fatal(err)
	}
	if brokenStored.GetString("last_error") == "" {
		t.Fatal("expected failed source to record last_error")
	}
	if brokenStored.GetInt("failure_streak") != 1 {
		t.Fatalf("expected failed source failure_streak to be 1, got %d", brokenStored.GetInt("failure_streak"))
	}
	if brokenStored.GetDateTime("next_poll_at").IsZero() {
		t.Fatal("expected failed source next_poll_at to be backoff scheduled")
	}
	if brokenStored.GetDateTime("last_success_at").IsZero() == false {
		t.Fatal("expected failed source not to set last_success_at")
	}
}

func TestPollSourcesForceFetchesActiveSourceEvenWhenNotDue(t *testing.T) {
	app := newFeedsTestApp(t)
	source := seedFeedSourceRecord(t, app, "Vendor feed", "https://example.com/feed.xml", FormatRSS, StatusActive)
	source.Set("next_poll_at", mustDateTime(time.Date(2026, 5, 27, 12, 30, 0, 0, time.UTC)))
	if err := app.Save(source); err != nil {
		t.Fatal(err)
	}

	data := readFeedFixture(t, "rss.xml")
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(string(data))), Header: make(http.Header)}, nil
	})}

	summary, err := PollSources(context.Background(), app, client, time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC), true)
	if err != nil {
		t.Fatalf("force poll sources: %v", err)
	}
	if summary.DueSources != 1 || summary.CreatedItems != 2 {
		t.Fatalf("unexpected force poll summary: %#v", summary)
	}
}

func TestPollSourceForceFetchesSingleSourceEvenWhenNotDue(t *testing.T) {
	app := newFeedsTestApp(t)
	source := seedFeedSourceRecord(t, app, "Vendor feed", "https://example.com/feed.xml", FormatRSS, StatusActive)
	source.Set("next_poll_at", mustDateTime(time.Date(2026, 5, 27, 12, 30, 0, 0, time.UTC)))
	if err := app.Save(source); err != nil {
		t.Fatal(err)
	}

	data := readFeedFixture(t, "rss.xml")
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(string(data))), Header: make(http.Header)}, nil
	})}

	summary, err := PollSource(context.Background(), app, client, time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC), source, true)
	if err != nil {
		t.Fatalf("force poll source: %v", err)
	}
	if summary.ProcessedSources != 1 || summary.DueSources != 1 || summary.CreatedItems != 2 {
		t.Fatalf("unexpected force single-source summary: %#v", summary)
	}
}

func TestPollDueSourcesDoesNotRunRetentionTrimDuringIngest(t *testing.T) {
	app := newFeedsTestApp(t)
	seedFeedSourceRecord(t, app, "Vendor feed", "https://example.com/feed.xml", FormatRSS, StatusActive)

	if err := sysconfig.SetGroup(app, SettingsModule, PolicySettingsKey, map[string]any{
		"pollIntervalHours":      3,
		"failureBackoffMaxHours": 24,
		"perSourceRetentionCap":  1,
		"globalRetentionCap":     1,
	}); err != nil {
		t.Fatalf("set feeds policy: %v", err)
	}

	data := readFeedFixture(t, "rss.xml")
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(string(data))), Header: make(http.Header)}, nil
	})}

	summary, err := PollDueSources(context.Background(), app, client, time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("poll due sources: %v", err)
	}
	if summary.CreatedItems != 2 {
		t.Fatalf("expected 2 created items, got %#v", summary)
	}

	items, err := app.FindAllRecords(CollectionItems)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("expected ingest to keep both feed items before scheduled retention sweep, got %d", len(items))
	}
}
