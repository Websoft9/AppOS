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
	if items[0].ContentRaw != "<p>Security fixes and <strong>maintenance</strong> update.</p>" {
		t.Fatalf("expected rss raw content preserved, got %q", items[0].ContentRaw)
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
	if items[0].ContentRaw != "<p>Release 2 summary with <em>HTML</em>.</p>" {
		t.Fatalf("expected atom summary html preserved as raw content, got %q", items[0].ContentRaw)
	}
	if items[1].ContentRaw != "<div>Patch release details.</div>" {
		t.Fatalf("expected atom content html preserved as raw content, got %q", items[1].ContentRaw)
	}
	if items[1].PublishedAt != time.Date(2026, 5, 28, 7, 30, 0, 0, time.UTC) {
		t.Fatalf("unexpected atom updated_at fallback: %v", items[1].PublishedAt)
	}
}

func TestParseFeedBytesAtomSupportsXHTMLContent(t *testing.T) {
	atom := []byte(`<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Atom Feed</title>
  <entry>
    <id>tag:example.com,2026:release-xhtml</id>
    <title>Release XHTML</title>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Structured <strong>HTML</strong> body.</p></div></content>
    <updated>2026-05-28T07:30:00Z</updated>
    <link href="https://example.com/releases/xhtml" />
  </entry>
</feed>`)

	items, err := ParseFeedBytes(FormatAtom, atom)
	if err != nil {
		t.Fatalf("parse atom xhtml fixture: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 atom item, got %d", len(items))
	}
	if items[0].ContentRaw != `<div xmlns="http://www.w3.org/1999/xhtml"><p>Structured <strong>HTML</strong> body.</p></div>` {
		t.Fatalf("expected xhtml body preserved, got %q", items[0].ContentRaw)
	}
	if items[0].Summary != "Structured HTML body." {
		t.Fatalf("expected summary extracted from xhtml content, got %q", items[0].Summary)
	}
}

func TestParseFeedBytesRSSPrefersContentEncoded(t *testing.T) {
	rss := []byte(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example Releases</title>
    <item>
      <guid>release-encoded</guid>
      <title>Release Encoded</title>
      <link>https://example.com/releases/encoded</link>
      <description><![CDATA[Short summary only.]]></description>
      <content:encoded><![CDATA[<p>Full <strong>HTML</strong> body.</p><p>Second paragraph.</p>]]></content:encoded>
      <pubDate>Thu, 28 May 2026 08:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`)

	items, err := ParseFeedBytes(FormatRSS, rss)
	if err != nil {
		t.Fatalf("parse rss content:encoded fixture: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 rss item, got %d", len(items))
	}
	if items[0].Summary != "Short summary only." {
		t.Fatalf("expected summary from description, got %q", items[0].Summary)
	}
	if items[0].ContentRaw != "<p>Full <strong>HTML</strong> body.</p><p>Second paragraph.</p>" {
		t.Fatalf("expected content_raw from content:encoded, got %q", items[0].ContentRaw)
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
	if analysis.FaviconURL != "https://example.com/favicon.ico" {
		t.Fatalf("expected rss favicon url, got %q", analysis.FaviconURL)
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
	if analysis.FaviconURL != "https://example.com/favicon.ico" {
		t.Fatalf("expected atom favicon url, got %q", analysis.FaviconURL)
	}
}

func TestAnalyzeSourcePrefersHomepageIconLink(t *testing.T) {
	feedData := readFeedFixture(t, "rss.xml")
	homepageHTML := `<html><head><link rel="icon" href="/assets/favicon-32.png"></head><body></body></html>`
	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		body := string(feedData)
		if req.URL.String() == "https://example.com" {
			body = homepageHTML
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(body)),
			Header:     make(http.Header),
			Request:    req,
		}, nil
	})}

	analysis, err := AnalyzeSource(context.Background(), "https://example.com/feed.xml", client)
	if err != nil {
		t.Fatalf("analyze source with homepage favicon: %v", err)
	}
	if analysis.FaviconURL != "https://example.com/assets/favicon-32.png" {
		t.Fatalf("expected homepage favicon url, got %q", analysis.FaviconURL)
	}
}

func TestAnalyzeBookmarkBytesExtractsMetadata(t *testing.T) {
	analysis, err := AnalyzeBookmarkBytes("https://example.com/post", []byte(`
		<html>
			<head>
				<title>Fallback Title</title>
				<meta property="og:title" content="OpenGraph Title">
				<meta name="description" content="Primary description">
				<link rel="icon" href="/favicon-32.png">
			</head>
			<body><h1>ignored</h1></body>
		</html>`))
	if err != nil {
		t.Fatalf("analyze bookmark html: %v", err)
	}
	if analysis.Title != "OpenGraph Title" {
		t.Fatalf("expected bookmark title from og:title, got %q", analysis.Title)
	}
	if analysis.Description != "Primary description" {
		t.Fatalf("expected bookmark description, got %q", analysis.Description)
	}
	if analysis.FaviconURL != "https://example.com/favicon-32.png" {
		t.Fatalf("expected resolved favicon url, got %q", analysis.FaviconURL)
	}
}

func TestAnalyzeBookmarkBytesFallsBackToDefaultFavicon(t *testing.T) {
	analysis, err := AnalyzeBookmarkBytes("https://example.com/docs/page", []byte(`
		<html>
			<head>
				<title>Plain Title</title>
			</head>
			<body></body>
		</html>`))
	if err != nil {
		t.Fatalf("analyze bookmark html fallback: %v", err)
	}
	if analysis.Title != "Plain Title" {
		t.Fatalf("expected title fallback, got %q", analysis.Title)
	}
	if analysis.FaviconURL != "https://example.com/favicon.ico" {
		t.Fatalf("expected default favicon url, got %q", analysis.FaviconURL)
	}
}