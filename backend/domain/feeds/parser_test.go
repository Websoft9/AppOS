package feeds

import (
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func readFeedFixture(t *testing.T, name string) []byte {
	t.Helper()
	path := filepath.Join("testdata", name)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return data
}

func TestParseFeedBytesRSS(t *testing.T) {
	items, err := ParseFeedBytes(FormatRSS, readFeedFixture(t, "rss.xml"))
	if err != nil {
		t.Fatalf("parse rss fixture: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 rss items, got %d", len(items))
	}
	if items[0].SourceItemID != "release-1" {
		t.Fatalf("expected guid release-1, got %q", items[0].SourceItemID)
	}
	if items[0].Link != "https://example.com/releases/1" {
		t.Fatalf("expected first rss link, got %q", items[0].Link)
	}
	if items[0].Summary != "Security fixes and maintenance update." {
		t.Fatalf("expected sanitized rss summary, got %q", items[0].Summary)
	}
	if items[0].PublishedAt != time.Date(2026, 5, 27, 8, 0, 0, 0, time.UTC) {
		t.Fatalf("unexpected rss published_at: %v", items[0].PublishedAt)
	}
	if items[1].SourceItemID != "" {
		t.Fatalf("expected second rss item to keep empty guid fallback path, got %q", items[1].SourceItemID)
	}
}

func TestParseFeedBytesAtom(t *testing.T) {
	items, err := ParseFeedBytes(FormatAtom, readFeedFixture(t, "atom.xml"))
	if err != nil {
		t.Fatalf("parse atom fixture: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 atom items, got %d", len(items))
	}
	if items[0].SourceItemID != "tag:example.com,2026:release-2" {
		t.Fatalf("unexpected atom id %q", items[0].SourceItemID)
	}
	if items[0].Link != "https://example.com/releases/2" {
		t.Fatalf("expected alternate atom link, got %q", items[0].Link)
	}
	if items[0].Summary != "Release 2 summary with HTML." {
		t.Fatalf("expected sanitized atom summary, got %q", items[0].Summary)
	}
	if items[1].PublishedAt != time.Date(2026, 5, 28, 7, 30, 0, 0, time.UTC) {
		t.Fatalf("unexpected atom updated_at fallback: %v", items[1].PublishedAt)
	}
}

func TestFetchAndParseSource(t *testing.T) {
	data := readFeedFixture(t, "rss.xml")
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.String() != "https://example.com/feed.xml" {
			t.Fatalf("unexpected request url %q", req.URL.String())
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(string(data))),
			Header:     make(http.Header),
		}, nil
	})}

	items, err := FetchAndParseSource(context.Background(), SourceSnapshot{
		URL:    "https://example.com/feed.xml",
		Format: FormatRSS,
	}, client)
	if err != nil {
		t.Fatalf("fetch and parse source: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 fetched items, got %d", len(items))
	}
	if items[0].Title != "Release 1" {
		t.Fatalf("expected first fetched title Release 1, got %q", items[0].Title)
	}
}

func TestAnalyzeSourceRSS(t *testing.T) {
	data := readFeedFixture(t, "rss.xml")
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(string(data))),
			Header:     make(http.Header),
			Request:    req,
		}, nil
	})}

	analysis, err := AnalyzeSource(context.Background(), "https://example.com/feed.xml", client)
	if err != nil {
		t.Fatalf("analyze rss source: %v", err)
	}
	if analysis.Format != FormatRSS {
		t.Fatalf("expected rss format, got %q", analysis.Format)
	}
	if analysis.Name != "Example Releases" {
		t.Fatalf("expected rss title as name, got %q", analysis.Name)
	}
	if analysis.SiteURL != "https://example.com" {
		t.Fatalf("expected rss site url, got %q", analysis.SiteURL)
	}
	if analysis.SiteTitle != "Example Releases" {
		t.Fatalf("expected rss site title, got %q", analysis.SiteTitle)
	}
	if analysis.FeedURL != "https://example.com/feed.xml" {
		t.Fatalf("expected rss feed url, got %q", analysis.FeedURL)
	}
}

func TestAnalyzeSourceAtom(t *testing.T) {
	data := readFeedFixture(t, "atom.xml")
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(string(data))),
			Header:     make(http.Header),
			Request:    req,
		}, nil
	})}

	analysis, err := AnalyzeSource(context.Background(), "https://example.com/atom.xml", client)
	if err != nil {
		t.Fatalf("analyze atom source: %v", err)
	}
	if analysis.Format != FormatAtom {
		t.Fatalf("expected atom format, got %q", analysis.Format)
	}
	if analysis.Name != "Example Atom Feed" {
		t.Fatalf("expected atom title as name, got %q", analysis.Name)
	}
	if analysis.SiteURL != "https://example.com" {
		t.Fatalf("expected atom site url, got %q", analysis.SiteURL)
	}
	if analysis.SiteTitle != "Example Atom Feed" {
		t.Fatalf("expected atom site title, got %q", analysis.SiteTitle)
	}
}