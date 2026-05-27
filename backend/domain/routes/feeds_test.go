package routes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/feeds"
)

func (te *testEnv) doFeeds(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	registerFeedsRoutes(&core.ServeEvent{Router: r})

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if authenticated {
		req.Header.Set("Authorization", te.token)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func seedFeedItemForRouteTest(t *testing.T, te *testEnv) *core.Record {
	t.Helper()

	source := seedFeedSourceForRouteTest(t, te, feeds.StatusActive)

	itemsCol, err := te.app.FindCollectionByNameOrId(feeds.CollectionItems)
	if err != nil {
		t.Fatal(err)
	}
	item := core.NewRecord(itemsCol)
	item.Set("source_id", source.Id)
	item.Set("origin_type", feeds.OriginTypeFeed)
	item.Set("external_id", "release-1")
	item.Set("title", "Release 1")
	item.Set("link", "https://example.com/releases/1")
	item.Set("summary", "Initial signal")
	item.Set("read_state", feeds.ReadStateUnread)
	item.Set("is_starred", false)
	if err := te.app.Save(item); err != nil {
		t.Fatal(err)
	}

	return item
}


func TestCreateBookmarkPersistsManualLink(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/bookmarks", `{"url":"https://example.com/docs/notice","title":"Vendor notice","summary":"Manual bookmark"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for create bookmark, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if payload["origin_type"] != feeds.OriginTypeBookmark {
		t.Fatalf("expected bookmark origin type, got %#v", payload)
	}

	stored, err := te.app.FindFirstRecordByFilter(feeds.CollectionItems, "origin_type = {:origin_type}", map[string]any{"origin_type": feeds.OriginTypeBookmark})
	if err != nil {
		t.Fatal(err)
	}
	if stored.GetString("link") != "https://example.com/docs/notice" {
		t.Fatalf("expected stored bookmark link, got %q", stored.GetString("link"))
	}
	if stored.GetBool("is_starred") {
		t.Fatal("expected bookmark to remain independent from article stars")
	}
	if stored.GetString("source_id") != "" {
		t.Fatalf("expected bookmark source_id to be empty, got %q", stored.GetString("source_id"))
	}
}

func TestDeleteBookmarkRemovesBookmarkRecord(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	created := te.doFeeds(t, http.MethodPost, "/api/feeds/bookmarks", `{"url":"https://example.com/docs/notice","title":"Vendor notice"}`, true)
	if created.Code != http.StatusOK {
		t.Fatalf("expected initial create bookmark success, got %d: %s", created.Code, created.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(created.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	bookmarkID, _ := payload["id"].(string)
	if bookmarkID == "" {
		t.Fatalf("expected bookmark id, got %#v", payload)
	}

	rec := te.doFeeds(t, http.MethodDelete, "/api/feeds/bookmarks/"+bookmarkID, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204 for delete bookmark, got %d: %s", rec.Code, rec.Body.String())
	}

	_, err := te.app.FindRecordById(feeds.CollectionItems, bookmarkID)
	if err == nil {
		t.Fatal("expected bookmark record to be deleted")
	}
}

func TestCreateBookmarkRejectsDuplicateLinkWithConflict(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	first := te.doFeeds(t, http.MethodPost, "/api/feeds/bookmarks", `{"url":"https://example.com/docs/notice","title":"Vendor notice"}`, true)
	if first.Code != http.StatusOK {
		t.Fatalf("expected initial create bookmark success, got %d: %s", first.Code, first.Body.String())
	}

	second := te.doFeeds(t, http.MethodPost, "/api/feeds/bookmarks", `{"url":"https://example.com/docs/notice/","title":"Duplicate title"}`, true)
	if second.Code != http.StatusConflict {
		t.Fatalf("expected duplicate bookmark call to return conflict, got %d: %s", second.Code, second.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(second.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if payload["code"] != "bookmark_exists" {
		t.Fatalf("expected bookmark_exists code, got %#v", payload)
	}

	items, err := te.app.FindRecordsByFilter(feeds.CollectionItems, "origin_type = {:origin_type}", "", 0, 0, map[string]any{"origin_type": feeds.OriginTypeBookmark})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one bookmark item after duplicate create, got %d", len(items))
	}
}
func seedFeedSourceForRouteTest(t *testing.T, te *testEnv, status string) *core.Record {
	t.Helper()

	sourceCol, err := te.app.FindCollectionByNameOrId(feeds.CollectionSources)
	if err != nil {
		t.Fatal(err)
	}
	source := core.NewRecord(sourceCol)
	source.Set("name", "Vendor feed")
	source.Set("url", "https://example.com/feed.xml")
	source.Set("format", feeds.FormatRSS)
	source.Set("status", status)
	source.Set("poll_interval_minutes", 60)
	if err := te.app.Save(source); err != nil {
		t.Fatal(err)
	}
	return source
}

func TestFeedItemStatePatchRejectsInvalidReadState(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	item := seedFeedItemForRouteTest(t, te)

	rec := te.doFeeds(t, http.MethodPatch, "/api/feeds/items/"+item.Id+"/state", `{"read_state":"invalid"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid state, got %d: %s", rec.Code, rec.Body.String())
	}

	reloaded, err := te.app.FindRecordById(feeds.CollectionItems, item.Id)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.GetString("read_state") != feeds.ReadStateUnread {
		t.Fatalf("expected invalid patch not to change read_state, got %q", reloaded.GetString("read_state"))
	}
}

func TestFeedItemStatePatchPersistsPreferences(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	item := seedFeedItemForRouteTest(t, te)

	rec := te.doFeeds(t, http.MethodPatch, "/api/feeds/items/"+item.Id+"/state", `{"read_state":"read","is_starred":true}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for valid state patch, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if payload["read_state"] != feeds.ReadStateRead {
		t.Fatalf("expected response read_state %q, got %v", feeds.ReadStateRead, payload["read_state"])
	}
	if payload["is_starred"] != true {
		t.Fatalf("expected response is_starred true, got %v", payload["is_starred"])
	}

	reloaded, err := te.app.FindRecordById(feeds.CollectionItems, item.Id)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.GetString("read_state") != feeds.ReadStateRead {
		t.Fatalf("expected persisted read_state %q, got %q", feeds.ReadStateRead, reloaded.GetString("read_state"))
	}
	if !reloaded.GetBool("is_starred") {
		t.Fatal("expected persisted is_starred true")
	}
}

func TestFeedsPollReturnsSummary(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/poll", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for manual feeds poll, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	summary, ok := payload["summary"].(map[string]any)
	if !ok {
		t.Fatalf("expected summary object, got %#v", payload["summary"])
	}
	if summary["ProcessedSources"] != float64(0) {
		t.Fatalf("expected empty poll summary, got %#v", summary)
	}
}

func TestFeedSourceAnalyzeReturnsMetadata(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	original := analyzeFeedSource
	analyzeFeedSource = func(_ context.Context, feedURL string, _ feeds.HTTPDoer) (feeds.SourceAnalysis, error) {
		if feedURL != "https://example.com/feed.xml" {
			t.Fatalf("expected analyze url, got %q", feedURL)
		}
		return feeds.SourceAnalysis{
			Name:    "Vendor Releases",
			FeedURL: feedURL,
			SiteURL: "https://example.com/releases",
			SiteTitle: "Vendor Releases",
			Format:  feeds.FormatRSS,
		}, nil
	}
	defer func() {
		analyzeFeedSource = original
	}()

	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/analyze", `{"url":"https://example.com/feed.xml"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for analyze source, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload feeds.SourceAnalysis
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if payload.Name != "Vendor Releases" {
		t.Fatalf("expected analyzed name, got %#v", payload)
	}
	if payload.Format != feeds.FormatRSS {
		t.Fatalf("expected analyzed format, got %#v", payload)
	}
	if payload.SiteURL != "https://example.com/releases" {
		t.Fatalf("expected analyzed site url, got %#v", payload)
	}
	if payload.SiteTitle != "Vendor Releases" {
		t.Fatalf("expected analyzed site title, got %#v", payload)
	}
}

func TestFeedSourceAnalyzeRejectsBlankURL(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/analyze", `{"url":" "}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for blank analyze url, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestFeedSourcePollReturnsSummary(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	source := seedFeedSourceForRouteTest(t, te, feeds.StatusActive)
	original := pollFeedSourceNow
	pollFeedSourceNow = func(_ context.Context, _ core.App, _ feeds.HTTPDoer, _ time.Time, record *core.Record, force bool) (feeds.PollSummary, error) {
		if record.Id != source.Id {
			t.Fatalf("expected source %q, got %q", source.Id, record.Id)
		}
		if !force {
			t.Fatal("expected source poll route to force polling")
		}
		return feeds.PollSummary{ProcessedSources: 1, DueSources: 1, CreatedItems: 2, UpdatedItems: 1}, nil
	}
	defer func() {
		pollFeedSourceNow = original
	}()

	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/sources/"+source.Id+"/poll", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for source poll, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	summary, ok := payload["summary"].(map[string]any)
	if !ok {
		t.Fatalf("expected summary object, got %#v", payload["summary"])
	}
	if summary["CreatedItems"] != float64(2) {
		t.Fatalf("expected created count in summary, got %#v", summary)
	}
}

func TestFeedSourcePollRejectsInactiveSource(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	source := seedFeedSourceForRouteTest(t, te, feeds.StatusPaused)
	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/sources/"+source.Id+"/poll", "", true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for inactive source pull, got %d: %s", rec.Code, rec.Body.String())
	}
}