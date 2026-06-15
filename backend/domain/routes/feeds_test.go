package routes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
	"github.com/websoft9/appos/backend/domain/feeds"
)

func testMustDateTime(t *testing.T, value time.Time) types.DateTime {
	t.Helper()
	parsed, err := types.ParseDateTime(value.UTC().Format(time.RFC3339))
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}

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
	item.Set("content_raw", "<p>Initial signal</p><p>Full detail</p>")
	item.Set("read_state", feeds.ReadStateUnread)
	item.Set("is_starred", false)
	if err := te.app.Save(item); err != nil {
		t.Fatal(err)
	}
	if err := feeds.RefreshSourceItemCount(te.app, source.Id); err != nil {
		t.Fatal(err)
	}

	return item
}

func TestFeedFaviconProxyAllowsQueryToken(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	original := fetchFaviconAsset
	defer func() { fetchFaviconAsset = original }()

	remoteURL := "https://www.websoft9.com/favicon-32x32.png?v=abc"
	var capturedURL string
	fetchFaviconAsset = func(_ context.Context, rawURL string, _ feeds.HTTPDoer) (feeds.FaviconAsset, error) {
		capturedURL = rawURL
		return feeds.FaviconAsset{ContentType: "image/png", Data: []byte("png")}, nil
	}

	rec := te.doFeeds(t, http.MethodGet, "/api/feeds/favicon?url="+url.QueryEscape(remoteURL)+"&token="+url.QueryEscape(te.token), "", false)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for favicon proxy, got %d: %s", rec.Code, rec.Body.String())
	}
	if capturedURL != remoteURL {
		t.Fatalf("expected proxied url %q, got %q", remoteURL, capturedURL)
	}
	if got := rec.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("expected image/png content type, got %q", got)
	}
	if rec.Body.String() != "png" {
		t.Fatalf("expected proxied image bytes, got %q", rec.Body.String())
	}
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
	if stored.GetString("favicon_url") != "" {
		t.Fatalf("expected bookmark favicon_url empty by default, got %q", stored.GetString("favicon_url"))
	}
	if stored.GetBool("is_starred") {
		t.Fatal("expected bookmark to remain independent from article stars")
	}
	if stored.GetString("source_id") != "" {
		t.Fatalf("expected bookmark source_id to be empty, got %q", stored.GetString("source_id"))
	}
}

func TestCreateBookmarkRejectsNonHTTPURL(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/bookmarks", `{"url":"ftp://example.com/docs/notice","title":"Vendor notice"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid bookmark scheme, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), feedURLSchemeMessage) {
		t.Fatalf("expected scheme validation message, got %s", rec.Body.String())
	}
}

func TestCreateBookmarkPersistsFaviconURL(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/bookmarks", `{"url":"https://example.com/docs/notice","title":"Vendor notice","favicon_url":"https://example.com/favicon.ico"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for create bookmark with favicon, got %d: %s", rec.Code, rec.Body.String())
	}

	stored, err := te.app.FindFirstRecordByFilter(feeds.CollectionItems, "origin_type = {:origin_type}", map[string]any{"origin_type": feeds.OriginTypeBookmark})
	if err != nil {
		t.Fatal(err)
	}
	if stored.GetString("favicon_url") != "https://example.com/favicon.ico" {
		t.Fatalf("expected stored favicon_url, got %q", stored.GetString("favicon_url"))
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

func TestUpdateBookmarkPersistsEditedFields(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	created := te.doFeeds(t, http.MethodPost, "/api/feeds/bookmarks", `{"url":"https://example.com/docs/notice","title":"Vendor notice","summary":"Original summary","favicon_url":"https://example.com/original.ico"}`, true)
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

	rec := te.doFeeds(t, http.MethodPatch, "/api/feeds/bookmarks/"+bookmarkID, `{"url":"https://www.websoft9.com/","title":"Websoft9","summary":"Updated description","favicon_url":"https://www.websoft9.com/favicon.ico"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for update bookmark, got %d: %s", rec.Code, rec.Body.String())
	}

	stored, err := te.app.FindRecordById(feeds.CollectionItems, bookmarkID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.GetString("link") != "https://www.websoft9.com/" {
		t.Fatalf("expected updated bookmark link, got %q", stored.GetString("link"))
	}
	if stored.GetString("summary") != "Updated description" {
		t.Fatalf("expected updated bookmark summary, got %q", stored.GetString("summary"))
	}
	if stored.GetString("favicon_url") != "https://www.websoft9.com/favicon.ico" {
		t.Fatalf("expected updated bookmark favicon_url, got %q", stored.GetString("favicon_url"))
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

func TestFeedItemBookmarkConvertsArticleIdentity(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	item := seedFeedItemForRouteTest(t, te)
	item.Set("favicon_url", "https://example.com/favicon.ico")
	item.Set("is_starred", true)
	if err := te.app.Save(item); err != nil {
		t.Fatal(err)
	}

	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/items/"+item.Id+"/bookmark", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for convert bookmark, got %d: %s", rec.Code, rec.Body.String())
	}

	stored, err := te.app.FindRecordById(feeds.CollectionItems, item.Id)
	if err != nil {
		t.Fatal(err)
	}
	if stored.GetString("origin_type") != feeds.OriginTypeBookmark {
		t.Fatalf("expected bookmark origin type, got %q", stored.GetString("origin_type"))
	}
	if stored.GetString("source_id") != "" {
		t.Fatalf("expected converted bookmark source_id empty, got %q", stored.GetString("source_id"))
	}
	if stored.GetBool("is_starred") {
		t.Fatal("expected converted bookmark to clear article star state")
	}
	if stored.GetString("external_id") != "example.com/releases/1" {
		t.Fatalf("expected bookmark external_id from link, got %q", stored.GetString("external_id"))
	}

	source, err := te.app.FindRecordById(feeds.CollectionSources, item.GetString("source_id"))
	if err != nil {
		t.Fatal(err)
	}
	if source.GetInt("item_count") != 0 {
		t.Fatalf("expected source item_count to be decremented after conversion, got %d", source.GetInt("item_count"))
	}
}

func TestFeedItemBookmarkRejectsDuplicateBookmarkLink(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	item := seedFeedItemForRouteTest(t, te)
	created := te.doFeeds(t, http.MethodPost, "/api/feeds/bookmarks", `{"url":"https://example.com/releases/1","title":"Existing bookmark"}`, true)
	if created.Code != http.StatusOK {
		t.Fatalf("expected initial create bookmark success, got %d: %s", created.Code, created.Body.String())
	}

	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/items/"+item.Id+"/bookmark", "", true)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected duplicate convert to return conflict, got %d: %s", rec.Code, rec.Body.String())
	}

	stored, err := te.app.FindRecordById(feeds.CollectionItems, item.Id)
	if err != nil {
		t.Fatal(err)
	}
	if stored.GetString("origin_type") != feeds.OriginTypeFeed {
		t.Fatalf("expected original item to remain feed, got %q", stored.GetString("origin_type"))
	}
}

func TestListBookmarksReturnsPaginatedResults(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	for _, body := range []string{
		`{"url":"https://example.com/docs/one","title":"First bookmark","summary":"Alpha note"}`,
		`{"url":"https://example.com/docs/two","title":"Second bookmark","summary":"Beta note"}`,
		`{"url":"https://example.com/docs/three","title":"Third bookmark","summary":"Gamma note"}`,
	} {
		rec := te.doFeeds(t, http.MethodPost, "/api/feeds/bookmarks", body, true)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected bookmark seed create success, got %d: %s", rec.Code, rec.Body.String())
		}
	}

	rec := te.doFeeds(t, http.MethodGet, "/api/feeds/bookmarks?page=2&perPage=2", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for list bookmarks, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload bookmarkListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if payload.Page != 2 || payload.PerPage != 2 {
		t.Fatalf("unexpected bookmark pagination payload: %#v", payload)
	}
	if payload.TotalItems != 3 || payload.TotalBookmarks != 3 {
		t.Fatalf("unexpected bookmark totals: %#v", payload)
	}
	if len(payload.Items) != 1 {
		t.Fatalf("expected one bookmark item on second page, got %#v", payload)
	}
}

func TestListBookmarksSupportsSearch(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	seedFeedItemForRouteTest(t, te)
	for _, body := range []string{
		`{"url":"https://example.com/docs/one","title":"Platform Guide","summary":"Alpha note"}`,
		`{"url":"https://example.com/docs/two","title":"Release Notes","summary":"Beta note"}`,
	} {
		rec := te.doFeeds(t, http.MethodPost, "/api/feeds/bookmarks", body, true)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected bookmark seed create success, got %d: %s", rec.Code, rec.Body.String())
		}
	}

	rec := te.doFeeds(t, http.MethodGet, "/api/feeds/bookmarks?q=platform", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for bookmark search, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload bookmarkListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if payload.TotalItems != 1 || payload.TotalBookmarks != 2 {
		t.Fatalf("unexpected bookmark search totals: %#v", payload)
	}
	if len(payload.Items) != 1 || payload.Items[0].Title != "Platform Guide" {
		t.Fatalf("unexpected bookmark search items: %#v", payload)
	}
}

func TestListFeedItemsReturnsPaginatedResults(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	item := seedFeedItemForRouteTest(t, te)
	item.Set("published_at", testMustDateTime(t, time.Date(2026, 5, 28, 11, 0, 0, 0, time.UTC)))
	if err := te.app.Save(item); err != nil {
		t.Fatal(err)
	}

	itemsCol, err := te.app.FindCollectionByNameOrId(feeds.CollectionItems)
	if err != nil {
		t.Fatal(err)
	}
	second := core.NewRecord(itemsCol)
	second.Set("source_id", item.GetString("source_id"))
	second.Set("origin_type", feeds.OriginTypeFeed)
	second.Set("external_id", "release-2")
	second.Set("title", "Release 2")
	second.Set("link", "https://example.com/releases/2")
	second.Set("summary", "Second signal")
	second.Set("read_state", feeds.ReadStateUnread)
	second.Set("is_starred", true)
	second.Set("published_at", testMustDateTime(t, time.Date(2026, 5, 28, 12, 0, 0, 0, time.UTC)))
	if err := te.app.Save(second); err != nil {
		t.Fatal(err)
	}
	third := core.NewRecord(itemsCol)
	third.Set("source_id", item.GetString("source_id"))
	third.Set("origin_type", feeds.OriginTypeFeed)
	third.Set("external_id", "release-3")
	third.Set("title", "Release 3")
	third.Set("link", "https://example.com/releases/3")
	third.Set("summary", "Third signal")
	third.Set("read_state", feeds.ReadStateUnread)
	third.Set("is_starred", false)
	third.Set("published_at", testMustDateTime(t, time.Date(2026, 5, 28, 13, 0, 0, 0, time.UTC)))
	if err := te.app.Save(third); err != nil {
		t.Fatal(err)
	}

	rec := te.doFeeds(t, http.MethodGet, "/api/feeds/items?page=2&perPage=2", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for list feed items, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload feedListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if payload.Page != 2 || payload.PerPage != 2 || payload.TotalItems != 3 {
		t.Fatalf("unexpected feed item pagination payload: %#v", payload)
	}
	if len(payload.Items) != 1 || payload.Items[0].Title != "Release 1" {
		t.Fatalf("unexpected paged feed items: %#v", payload)
	}
	if payload.Items[0].ContentRaw != "<p>Initial signal</p><p>Full detail</p>" {
		t.Fatalf("expected raw content in feed item payload, got %#v", payload.Items[0])
	}
	if payload.Items[0].Expand.SourceID == nil || payload.Items[0].Expand.SourceID.Name != "Vendor feed" {
		t.Fatalf("expected expanded source payload, got %#v", payload.Items[0])
	}
}

func TestListFeedItemsSupportsFiltersAndSearch(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	firstSource := seedFeedSourceForRouteTest(t, te, feeds.StatusActive)
	sourceCol, err := te.app.FindCollectionByNameOrId(feeds.CollectionSources)
	if err != nil {
		t.Fatal(err)
	}
	secondSource := core.NewRecord(sourceCol)
	secondSource.Set("name", "Platform updates")
	secondSource.Set("url", "https://example.com/platform.xml")
	secondSource.Set("format", feeds.FormatRSS)
	secondSource.Set("status", feeds.StatusActive)
	secondSource.Set("failure_streak", 0)
	if err := te.app.Save(secondSource); err != nil {
		t.Fatal(err)
	}

	itemsCol, err := te.app.FindCollectionByNameOrId(feeds.CollectionItems)
	if err != nil {
		t.Fatal(err)
	}
	first := core.NewRecord(itemsCol)
	first.Set("source_id", firstSource.Id)
	first.Set("origin_type", feeds.OriginTypeFeed)
	first.Set("external_id", "release-a")
	first.Set("title", "Vendor Notice")
	first.Set("link", "https://example.com/releases/a")
	first.Set("summary", "Alpha entry")
	first.Set("read_state", feeds.ReadStateUnread)
	first.Set("is_starred", false)
	if err := te.app.Save(first); err != nil {
		t.Fatal(err)
	}
	second := core.NewRecord(itemsCol)
	second.Set("source_id", secondSource.Id)
	second.Set("origin_type", feeds.OriginTypeFeed)
	second.Set("external_id", "release-b")
	second.Set("title", "Operational Update")
	second.Set("link", "https://example.com/releases/b")
	second.Set("summary", "Platform alpha change")
	second.Set("read_state", feeds.ReadStateUnread)
	second.Set("is_starred", true)
	if err := te.app.Save(second); err != nil {
		t.Fatal(err)
	}

	rec := te.doFeeds(t, http.MethodGet, "/api/feeds/items?sourceId="+secondSource.Id+"&starred=true&q=platform", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for filtered feed items, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload feedListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if payload.TotalItems != 1 || len(payload.Items) != 1 || payload.Items[0].Title != "Operational Update" {
		t.Fatalf("unexpected filtered feed items: %#v", payload)
	}
}

func TestFeedSummaryReturnsGlobalAndSourceCounts(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	firstSource := seedFeedSourceForRouteTest(t, te, feeds.StatusActive)
	sourceCol, err := te.app.FindCollectionByNameOrId(feeds.CollectionSources)
	if err != nil {
		t.Fatal(err)
	}
	secondSource := core.NewRecord(sourceCol)
	secondSource.Set("name", "Platform updates")
	secondSource.Set("url", "https://example.com/platform.xml")
	secondSource.Set("format", feeds.FormatRSS)
	secondSource.Set("status", feeds.StatusActive)
	secondSource.Set("failure_streak", 0)
	if err := te.app.Save(secondSource); err != nil {
		t.Fatal(err)
	}

	itemsCol, err := te.app.FindCollectionByNameOrId(feeds.CollectionItems)
	if err != nil {
		t.Fatal(err)
	}
	for _, spec := range []struct {
		sourceID  string
		external  string
		title     string
		isStarred bool
	}{
		{sourceID: firstSource.Id, external: "release-a", title: "Vendor A", isStarred: false},
		{sourceID: firstSource.Id, external: "release-b", title: "Vendor B", isStarred: true},
		{sourceID: secondSource.Id, external: "release-c", title: "Platform C", isStarred: false},
	} {
		record := core.NewRecord(itemsCol)
		record.Set("source_id", spec.sourceID)
		record.Set("origin_type", feeds.OriginTypeFeed)
		record.Set("external_id", spec.external)
		record.Set("title", spec.title)
		record.Set("link", "https://example.com/"+spec.external)
		record.Set("summary", "Signal")
		record.Set("read_state", feeds.ReadStateUnread)
		record.Set("is_starred", spec.isStarred)
		if err := te.app.Save(record); err != nil {
			t.Fatal(err)
		}
	}
	if err := feeds.RefreshSourceItemCount(te.app, firstSource.Id); err != nil {
		t.Fatal(err)
	}
	if err := feeds.RefreshSourceItemCount(te.app, secondSource.Id); err != nil {
		t.Fatal(err)
	}

	rec := te.doFeeds(t, http.MethodGet, "/api/feeds/summary", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for feed summary, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload feedSummaryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if payload.TotalItems != 3 || payload.StarredItems != 1 {
		t.Fatalf("unexpected feed summary totals: %#v", payload)
	}
	counts := map[string]int{}
	for _, row := range payload.SourceCounts {
		counts[row.SourceID] = row.Count
	}
	if counts[firstSource.Id] != 2 || counts[secondSource.Id] != 1 {
		t.Fatalf("unexpected feed summary source counts: %#v", payload)
	}
}

func TestFeedSourceDeleteRemovesOldestArticlesByCount(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	firstSource := seedFeedSourceForRouteTest(t, te, feeds.StatusActive)
	secondSourceCol, err := te.app.FindCollectionByNameOrId(feeds.CollectionSources)
	if err != nil {
		t.Fatal(err)
	}
	secondSource := core.NewRecord(secondSourceCol)
	secondSource.Set("name", "Platform updates")
	secondSource.Set("url", "https://example.com/platform.xml")
	secondSource.Set("format", feeds.FormatRSS)
	secondSource.Set("status", feeds.StatusActive)
	secondSource.Set("failure_streak", 0)
	if err := te.app.Save(secondSource); err != nil {
		t.Fatal(err)
	}

	itemsCol, err := te.app.FindCollectionByNameOrId(feeds.CollectionItems)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	for _, spec := range []struct {
		sourceID   string
		externalID string
		originType string
		published  time.Time
	}{
		{sourceID: firstSource.Id, externalID: "a-1", originType: feeds.OriginTypeFeed, published: base.Add(-3 * time.Hour)},
		{sourceID: firstSource.Id, externalID: "a-2", originType: feeds.OriginTypeFeed, published: base.Add(-2 * time.Hour)},
		{sourceID: firstSource.Id, externalID: "a-3", originType: feeds.OriginTypeFeed, published: base.Add(-1 * time.Hour)},
		{sourceID: secondSource.Id, externalID: "b-1", originType: feeds.OriginTypeFeed, published: base},
		{sourceID: "", externalID: "bookmark-1", originType: feeds.OriginTypeBookmark, published: base.Add(time.Hour)},
	} {
		record := core.NewRecord(itemsCol)
		record.Set("source_id", spec.sourceID)
		record.Set("origin_type", spec.originType)
		record.Set("external_id", spec.externalID)
		record.Set("title", spec.externalID)
		record.Set("link", "https://example.com/"+spec.externalID)
		record.Set("read_state", feeds.ReadStateUnread)
		record.Set("is_starred", false)
		record.Set("published_at", testMustDateTime(t, spec.published))
		if err := te.app.Save(record); err != nil {
			t.Fatal(err)
		}
	}
	if err := feeds.RefreshSourceItemCount(te.app, firstSource.Id); err != nil {
		t.Fatal(err)
	}
	if err := feeds.RefreshSourceItemCount(te.app, secondSource.Id); err != nil {
		t.Fatal(err)
	}

	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/sources/"+firstSource.Id+"/delete", `{"count":2}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for source delete, got %d: %s", rec.Code, rec.Body.String())
	}

	var result feeds.SourceDeleteResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if result.SourceID != firstSource.Id || result.DeletedCount != 2 || result.RemainingCount != 1 {
		t.Fatalf("unexpected source delete result: %#v", result)
	}

	remainingFeedItems, err := te.app.FindRecordsByFilter(feeds.CollectionItems, "origin_type = {:origin_type}", "published_at", 10, 0, dbx.Params{"origin_type": feeds.OriginTypeFeed})
	if err != nil {
		t.Fatal(err)
	}
	if len(remainingFeedItems) != 2 {
		t.Fatalf("expected 2 feed items to remain, got %d", len(remainingFeedItems))
	}
	remainingIDs := make([]string, 0, len(remainingFeedItems))
	for _, item := range remainingFeedItems {
		remainingIDs = append(remainingIDs, item.GetString("external_id"))
	}
	if !containsStringValue(remainingIDs, "a-3") || !containsStringValue(remainingIDs, "b-1") {
		t.Fatalf("expected newest source item and unrelated source item to remain, got %v", remainingIDs)
	}
	if containsStringValue(remainingIDs, "a-1") || containsStringValue(remainingIDs, "a-2") {
		t.Fatalf("expected oldest source items to be deleted, got %v", remainingIDs)
	}
	bookmark, err := te.app.FindFirstRecordByFilter(feeds.CollectionItems, "external_id = {:external_id}", map[string]any{"external_id": "bookmark-1"})
	if err != nil {
		t.Fatal(err)
	}
	if bookmark.GetString("origin_type") != feeds.OriginTypeBookmark {
		t.Fatalf("expected bookmark to survive source delete, got %#v", bookmark)
	}
}

func TestFeedDeleteRemovesOldestArticlesGloballyByCount(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	firstSource := seedFeedSourceForRouteTest(t, te, feeds.StatusActive)
	secondSourceCol, err := te.app.FindCollectionByNameOrId(feeds.CollectionSources)
	if err != nil {
		t.Fatal(err)
	}
	secondSource := core.NewRecord(secondSourceCol)
	secondSource.Set("name", "Platform updates")
	secondSource.Set("url", "https://example.com/platform.xml")
	secondSource.Set("format", feeds.FormatRSS)
	secondSource.Set("status", feeds.StatusActive)
	secondSource.Set("failure_streak", 0)
	if err := te.app.Save(secondSource); err != nil {
		t.Fatal(err)
	}

	itemsCol, err := te.app.FindCollectionByNameOrId(feeds.CollectionItems)
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	for _, spec := range []struct {
		sourceID   string
		externalID string
		originType string
		published  time.Time
	}{
		{sourceID: firstSource.Id, externalID: "a-1", originType: feeds.OriginTypeFeed, published: base.Add(-4 * time.Hour)},
		{sourceID: firstSource.Id, externalID: "a-2", originType: feeds.OriginTypeFeed, published: base.Add(-2 * time.Hour)},
		{sourceID: secondSource.Id, externalID: "b-1", originType: feeds.OriginTypeFeed, published: base.Add(-3 * time.Hour)},
		{sourceID: secondSource.Id, externalID: "b-2", originType: feeds.OriginTypeFeed, published: base.Add(-1 * time.Hour)},
		{sourceID: "", externalID: "bookmark-1", originType: feeds.OriginTypeBookmark, published: base},
	} {
		record := core.NewRecord(itemsCol)
		record.Set("source_id", spec.sourceID)
		record.Set("origin_type", spec.originType)
		record.Set("external_id", spec.externalID)
		record.Set("title", spec.externalID)
		record.Set("link", "https://example.com/"+spec.externalID)
		record.Set("read_state", feeds.ReadStateUnread)
		record.Set("is_starred", false)
		record.Set("published_at", testMustDateTime(t, spec.published))
		if err := te.app.Save(record); err != nil {
			t.Fatal(err)
		}
	}
	if err := feeds.RefreshSourceItemCount(te.app, firstSource.Id); err != nil {
		t.Fatal(err)
	}
	if err := feeds.RefreshSourceItemCount(te.app, secondSource.Id); err != nil {
		t.Fatal(err)
	}

	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/delete", `{"count":2}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for global delete, got %d: %s", rec.Code, rec.Body.String())
	}

	var result feeds.GlobalDeleteResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if result.DeletedCount != 2 || result.RemainingCount != 2 {
		t.Fatalf("unexpected global delete result: %#v", result)
	}

	remainingFeedItems, err := te.app.FindRecordsByFilter(feeds.CollectionItems, "origin_type = {:origin_type}", "published_at", 10, 0, dbx.Params{"origin_type": feeds.OriginTypeFeed})
	if err != nil {
		t.Fatal(err)
	}
	remainingIDs := make([]string, 0, len(remainingFeedItems))
	for _, item := range remainingFeedItems {
		remainingIDs = append(remainingIDs, item.GetString("external_id"))
	}
	if !containsStringValue(remainingIDs, "a-2") || !containsStringValue(remainingIDs, "b-2") {
		t.Fatalf("expected newest feed items to remain, got %v", remainingIDs)
	}
	if containsStringValue(remainingIDs, "a-1") || containsStringValue(remainingIDs, "b-1") {
		t.Fatalf("expected oldest feed items to be deleted, got %v", remainingIDs)
	}

	bookmark, err := te.app.FindFirstRecordByFilter(feeds.CollectionItems, "external_id = {:external_id}", map[string]any{"external_id": "bookmark-1"})
	if err != nil {
		t.Fatal(err)
	}
	if bookmark.GetString("origin_type") != feeds.OriginTypeBookmark {
		t.Fatalf("expected bookmark to survive global delete, got %#v", bookmark)
	}
}

func containsStringValue(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
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
	source.Set("failure_streak", 0)
	if err := te.app.Save(source); err != nil {
		t.Fatal(err)
	}
	return source
}

func TestListFeedSourcesReturnsBoundedContextPayload(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	source := seedFeedSourceForRouteTest(t, te, feeds.StatusActive)
	source.Set("item_count", 3)
	if err := te.app.Save(source); err != nil {
		t.Fatal(err)
	}

	rec := te.doFeeds(t, http.MethodGet, "/api/feeds/sources", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for list feed sources, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if len(payload.Items) != 1 {
		t.Fatalf("expected one feed source, got %#v", payload.Items)
	}
	if payload.Items[0]["id"] != source.Id || payload.Items[0]["item_count"] != float64(3) {
		t.Fatalf("unexpected feed source payload: %#v", payload.Items[0])
	}
}

func TestCreateFeedSourcePersistsThroughFeedsRoute(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/sources", `{"name":"Vendor feed","url":"https://example.com/feed.xml","favicon_url":"https://example.com/favicon.ico","format":"rss","status":"active"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for create feed source, got %d: %s", rec.Code, rec.Body.String())
	}

	stored, err := te.app.FindFirstRecordByFilter(feeds.CollectionSources, "url = {:url}", map[string]any{"url": "https://example.com/feed.xml"})
	if err != nil {
		t.Fatal(err)
	}
	if stored.GetString("name") != "Vendor feed" || stored.GetString("status") != feeds.StatusActive {
		t.Fatalf("unexpected stored feed source: %#v", stored)
	}
}

func TestCreateFeedSourceRejectsNonHTTPURL(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/sources", `{"name":"Vendor feed","url":"ftp://example.com/feed.xml","favicon_url":"https://example.com/favicon.ico","format":"rss","status":"active"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid feed source scheme, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), feedURLSchemeMessage) {
		t.Fatalf("expected scheme validation message, got %s", rec.Body.String())
	}
}

func TestCreateFeedSourceRejectsDuplicateURLWithConflict(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	seedFeedSourceForRouteTest(t, te, feeds.StatusActive)
	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/sources", `{"name":"Another feed","url":"https://example.com/feed.xml","favicon_url":"https://example.com/favicon.ico","format":"rss","status":"active"}`, true)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 for duplicate feed source url, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if payload["code"] != feeds.SourceConflictCodeExists {
		t.Fatalf("expected conflict code %q, got %#v", feeds.SourceConflictCodeExists, payload)
	}
}

func TestUpdateFeedSourcePersistsThroughFeedsRoute(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	source := seedFeedSourceForRouteTest(t, te, feeds.StatusActive)
	rec := te.doFeeds(t, http.MethodPatch, "/api/feeds/sources/"+source.Id, `{"name":"Updated feed","url":"https://example.com/feed.xml","favicon_url":"https://example.com/updated.ico","format":"rss","status":"paused"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for update feed source, got %d: %s", rec.Code, rec.Body.String())
	}

	reloaded, err := te.app.FindRecordById(feeds.CollectionSources, source.Id)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.GetString("name") != "Updated feed" || reloaded.GetString("favicon_url") != "https://example.com/updated.ico" || reloaded.GetString("format") != feeds.FormatRSS || reloaded.GetString("status") != feeds.StatusPaused {
		t.Fatalf("unexpected updated feed source: %#v", reloaded)
	}
}

func TestUpdateFeedSourceRejectsIdentityChange(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	source := seedFeedSourceForRouteTest(t, te, feeds.StatusActive)

	rec := te.doFeeds(t, http.MethodPatch, "/api/feeds/sources/"+source.Id, `{"name":"Updated feed","url":"https://example.com/updated.xml","favicon_url":"https://example.com/updated.ico","format":"atom","status":"active"}`, true)
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 for update feed source identity change, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if payload["code"] != feeds.SourceConflictCodeIdentityLocked {
		t.Fatalf("expected conflict code %q, got %#v", feeds.SourceConflictCodeIdentityLocked, payload)
	}
}

func TestDeleteFeedSourceRemovesRecordThroughFeedsRoute(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	source := seedFeedSourceForRouteTest(t, te, feeds.StatusActive)
	rec := te.doFeeds(t, http.MethodDelete, "/api/feeds/sources/"+source.Id, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204 for delete feed source, got %d: %s", rec.Code, rec.Body.String())
	}

	if _, err := te.app.FindRecordById(feeds.CollectionSources, source.Id); err == nil {
		t.Fatal("expected feed source record to be deleted")
	}
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
			Name:       "Vendor Releases",
			FeedURL:    feedURL,
			SiteURL:    "https://example.com/releases",
			SiteTitle:  "Vendor Releases",
			FaviconURL: "https://example.com/favicon.ico",
			Format:     feeds.FormatRSS,
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
	if payload.FaviconURL != "https://example.com/favicon.ico" {
		t.Fatalf("expected analyzed favicon url, got %#v", payload)
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

func TestFeedSourceAnalyzeRejectsNonHTTPURL(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/analyze", `{"url":"ftp://example.com/feed.xml"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid analyze url scheme, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), feedURLSchemeMessage) {
		t.Fatalf("expected scheme validation message, got %s", rec.Body.String())
	}
}

func TestAnalyzeBookmarkReturnsMetadata(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	original := analyzeBookmarkURL
	analyzeBookmarkURL = func(_ context.Context, bookmarkURL string, _ feeds.HTTPDoer) (feeds.BookmarkAnalysis, error) {
		if bookmarkURL != "https://example.com/post" {
			t.Fatalf("expected bookmark analyze url, got %q", bookmarkURL)
		}
		return feeds.BookmarkAnalysis{
			Title:       "Example Post",
			Description: "Short summary",
			FaviconURL:  "https://example.com/favicon.ico",
			ResolvedURL: bookmarkURL,
		}, nil
	}
	defer func() {
		analyzeBookmarkURL = original
	}()

	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/bookmarks/analyze", `{"url":"https://example.com/post"}`, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for analyze bookmark, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload feeds.BookmarkAnalysis
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("expected JSON response, got error: %v", err)
	}
	if payload.Title != "Example Post" || payload.Description != "Short summary" || payload.FaviconURL != "https://example.com/favicon.ico" {
		t.Fatalf("unexpected bookmark analysis payload: %#v", payload)
	}
}

func TestAnalyzeBookmarkRejectsBlankURL(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/bookmarks/analyze", `{"url":" "}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for blank bookmark analyze url, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAnalyzeBookmarkRejectsNonHTTPURL(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doFeeds(t, http.MethodPost, "/api/feeds/bookmarks/analyze", `{"url":"ftp://example.com/post"}`, true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid bookmark analyze url scheme, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), feedURLSchemeMessage) {
		t.Fatalf("expected scheme validation message, got %s", rec.Body.String())
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
