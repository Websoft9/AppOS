package feeds

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func TestNormalizeItemUsesSourceIDAndNormalizesLists(t *testing.T) {
	candidate := ItemCandidate{
		SourceItemID: " item-42 ",
		Link:         " https://example.com/releases/42/ ",
		Title:        " Release 42 ",
		Summary:      "  Security fixes and maintenance.  ",
		PublishedAt:  time.Date(2026, 5, 27, 9, 0, 0, 0, time.FixedZone("UTC+8", 8*3600)),
		Keywords:     []string{" Security ", "maintenance", "security", ""},
		Tags:         []string{" Release ", "release", "breaking-change"},
	}

	normalized := NormalizeItem(candidate)
	if normalized.ExternalID != "item-42" {
		t.Fatalf("expected external id from source item id, got %q", normalized.ExternalID)
	}
	if normalized.Link != "https://example.com/releases/42/" {
		t.Fatalf("expected trimmed link, got %q", normalized.Link)
	}
	if normalized.Title != "Release 42" {
		t.Fatalf("expected trimmed title, got %q", normalized.Title)
	}
	if normalized.Summary != "Security fixes and maintenance." {
		t.Fatalf("expected trimmed summary, got %q", normalized.Summary)
	}
	if normalized.PublishedAt.Location() != time.UTC {
		t.Fatalf("expected published time to be normalized to UTC, got %v", normalized.PublishedAt.Location())
	}
	if len(normalized.Keywords) != 2 || normalized.Keywords[0] != "security" || normalized.Keywords[1] != "maintenance" {
		t.Fatalf("unexpected normalized keywords: %#v", normalized.Keywords)
	}
	if len(normalized.Tags) != 2 || normalized.Tags[0] != "release" || normalized.Tags[1] != "breaking-change" {
		t.Fatalf("unexpected normalized tags: %#v", normalized.Tags)
	}
	if normalized.ReadState != ReadStateUnread {
		t.Fatalf("expected default read state %q, got %q", ReadStateUnread, normalized.ReadState)
	}
	if normalized.IsStarred {
		t.Fatal("expected normalized item to default to unstarred")
	}
}

func TestNormalizeItemFallsBackToNormalizedLinkForExternalID(t *testing.T) {
	normalized := NormalizeItem(ItemCandidate{
		Link:  "HTTPS://Example.com/Releases/42/",
		Title: "Release 42",
	})
	if normalized.ExternalID != "example.com/releases/42" {
		t.Fatalf("expected normalized link external id, got %q", normalized.ExternalID)
	}
}

func TestPreserveItemPreferencesKeepExistingValues(t *testing.T) {
	next := NormalizeItem(ItemCandidate{Link: "https://example.com/releases/42", Title: "Release 42"})
	if got := PreserveItemReadState(nil, next); got != ReadStateUnread {
		t.Fatalf("expected new items to default to %q, got %q", ReadStateUnread, got)
	}
	if PreserveItemStarred(nil, next) {
		t.Fatal("expected new items to default to unstarred")
	}

	rec := core.NewRecord(core.NewBaseCollection(CollectionItems))
	rec.Set("read_state", ReadStateRead)
	rec.Set("is_starred", true)
	if got := PreserveItemReadState(rec, next); got != ReadStateRead {
		t.Fatalf("expected existing read state to be preserved, got %q", got)
	}
	if !PreserveItemStarred(rec, next) {
		t.Fatal("expected existing starred preference to be preserved")
	}
}

func TestIsValidReadState(t *testing.T) {
	valid := []string{ReadStateUnread, ReadStateRead}
	for _, state := range valid {
		if !IsValidReadState(state) {
			t.Fatalf("expected read state %q to be valid", state)
		}
	}

	if IsValidReadState("unknown") {
		t.Fatal("expected unknown read state to be invalid")
	}
}