package feeds

import (
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const (
	CollectionItems = "feed_items"

	OriginTypeFeed     = "feed"
	OriginTypeBookmark = "bookmark"

	ReadStateUnread = "unread"
	ReadStateRead   = "read"
)

func IsValidOriginType(value string) bool {
	switch strings.TrimSpace(value) {
	case OriginTypeFeed, OriginTypeBookmark:
		return true
	default:
		return false
	}
}

func IsValidReadState(value string) bool {
	switch strings.TrimSpace(value) {
	case ReadStateUnread, ReadStateRead:
		return true
	default:
		return false
	}
}

type ItemCandidate struct {
	SourceItemID string
	Link         string
	Title        string
	Summary      string
	PublishedAt  time.Time
	Keywords     []string
	Tags         []string
}

type NormalizedItem struct {
	ExternalID  string
	Link        string
	Title       string
	Summary     string
	PublishedAt time.Time
	Keywords    []string
	Tags        []string
	OriginType  string
	ReadState   string
	IsStarred   bool
}

func NormalizeItem(candidate ItemCandidate) NormalizedItem {
	return NormalizedItem{
		ExternalID:  computeExternalID(candidate.SourceItemID, candidate.Link),
		Link:        strings.TrimSpace(candidate.Link),
		Title:       strings.TrimSpace(candidate.Title),
		Summary:     strings.TrimSpace(candidate.Summary),
		PublishedAt: candidate.PublishedAt.UTC(),
		Keywords:    normalizeStringList(candidate.Keywords),
		Tags:        normalizeStringList(candidate.Tags),
		OriginType:  OriginTypeFeed,
		ReadState:   ReadStateUnread,
		IsStarred:   false,
	}
}

func PreserveItemReadState(existing *core.Record, next NormalizedItem) string {
	if existing == nil {
		return next.ReadState
	}
	current := strings.TrimSpace(existing.GetString("read_state"))
	if current == "" {
		return next.ReadState
	}
	return current
}

func PreserveItemStarred(existing *core.Record, next NormalizedItem) bool {
	if existing == nil {
		return next.IsStarred
	}
	return existing.GetBool("is_starred")
}

func computeExternalID(sourceItemID, link string) string {
	if trimmed := strings.TrimSpace(sourceItemID); trimmed != "" {
		return trimmed
	}
	return normalizeLink(link)
}

func normalizeLink(link string) string {
	trimmed := strings.TrimSpace(strings.ToLower(link))
	trimmed = strings.TrimPrefix(trimmed, "https://")
	trimmed = strings.TrimPrefix(trimmed, "http://")
	trimmed = strings.TrimSuffix(trimmed, "/")
	return trimmed
}

func normalizeStringList(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		normalized := strings.TrimSpace(strings.ToLower(value))
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}
	return result
}