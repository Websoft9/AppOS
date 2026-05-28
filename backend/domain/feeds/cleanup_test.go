package feeds

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func seedCleanupSource(t *testing.T, app core.App, name string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(CollectionSources)
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", name)
	rec.Set("url", "https://example.com/"+name+".xml")
	rec.Set("format", FormatRSS)
	rec.Set("status", StatusActive)
	rec.Set("failure_streak", 0)
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func seedCleanupFeedItem(t *testing.T, app core.App, sourceID, externalID string, publishedAt time.Time, originType string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(CollectionItems)
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("source_id", sourceID)
	rec.Set("origin_type", originType)
	rec.Set("external_id", externalID)
	rec.Set("title", externalID)
	rec.Set("link", "https://example.com/items/"+externalID)
	rec.Set("read_state", ReadStateUnread)
	rec.Set("is_starred", false)
	if !publishedAt.IsZero() {
		rec.Set("published_at", mustDateTime(publishedAt))
	}
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func TestBuildCleanupPlanTrimsPerSourceBeforeGlobalAndExcludesBookmarks(t *testing.T) {
	app := newFeedsTestApp(t)
	first := seedCleanupSource(t, app, "alpha")
	second := seedCleanupSource(t, app, "beta")

	base := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	seedCleanupFeedItem(t, app, first.Id, "a-newest", base.Add(5*time.Minute), OriginTypeFeed)
	seedCleanupFeedItem(t, app, first.Id, "a-middle", base.Add(4*time.Minute), OriginTypeFeed)
	seedCleanupFeedItem(t, app, first.Id, "a-oldest", base.Add(3*time.Minute), OriginTypeFeed)
	seedCleanupFeedItem(t, app, second.Id, "b-newest", base.Add(2*time.Minute), OriginTypeFeed)
	seedCleanupFeedItem(t, app, second.Id, "b-middle", base.Add(1*time.Minute), OriginTypeFeed)
	seedCleanupFeedItem(t, app, second.Id, "b-oldest", base, OriginTypeFeed)
	seedCleanupFeedItem(t, app, "", "bookmark-1", base.Add(-time.Minute), OriginTypeBookmark)

	plan, err := buildCleanupPlan(app, 2, 3)
	if err != nil {
		t.Fatalf("build cleanup plan: %v", err)
	}
	if plan.Preview.GlobalTotalBefore != 6 {
		t.Fatalf("expected 6 eligible feed items, got %#v", plan.Preview)
	}
	if plan.Preview.PerSourceDeleteCount != 2 {
		t.Fatalf("expected 2 per-source deletions, got %#v", plan.Preview)
	}
	if plan.Preview.GlobalDeleteCount != 1 {
		t.Fatalf("expected 1 global deletion after per-source trim, got %#v", plan.Preview)
	}
	if plan.Preview.TotalDeleteCount != 3 {
		t.Fatalf("expected 3 total deletions, got %#v", plan.Preview)
	}
	if len(plan.Preview.Sources) != 2 {
		t.Fatalf("expected 2 affected sources, got %#v", plan.Preview.Sources)
	}

	result, err := executeCleanupPlan(app, plan)
	if err != nil {
		t.Fatalf("execute cleanup plan: %v", err)
	}
	if result.DeletedCount != 3 || result.GlobalTotalAfter != 3 {
		t.Fatalf("unexpected cleanup result: %#v", result)
	}

	remaining, err := app.FindAllRecords(CollectionItems)
	if err != nil {
		t.Fatal(err)
	}
	remainingExternalIDs := map[string]bool{}
	for _, record := range remaining {
		remainingExternalIDs[record.GetString("external_id")] = true
	}
	for _, removed := range []string{"a-oldest", "b-oldest", "b-middle"} {
		if remainingExternalIDs[removed] {
			t.Fatalf("expected %s to be removed, remaining ids: %#v", removed, remainingExternalIDs)
		}
	}
	if !remainingExternalIDs["bookmark-1"] {
		t.Fatalf("expected bookmark to be excluded from cleanup, remaining ids: %#v", remainingExternalIDs)
	}

	firstStored, err := app.FindRecordById(CollectionSources, first.Id)
	if err != nil {
		t.Fatal(err)
	}
	secondStored, err := app.FindRecordById(CollectionSources, second.Id)
	if err != nil {
		t.Fatal(err)
	}
	if firstStored.GetInt("item_count") != 2 || secondStored.GetInt("item_count") != 1 {
		t.Fatalf("expected refreshed source counts after cleanup, got %d and %d", firstStored.GetInt("item_count"), secondStored.GetInt("item_count"))
	}
}