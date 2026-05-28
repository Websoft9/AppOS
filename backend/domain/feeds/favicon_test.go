package feeds

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type faviconDoer func(*http.Request) (*http.Response, error)

func (f faviconDoer) Do(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestFetchFaviconSendsBrowserLikeHeaders(t *testing.T) {
	prepareFaviconCacheForTest(t)

	var referer string
	var userAgent string
	asset, err := FetchFavicon(context.Background(), "https://www.websoft9.com/favicon-32x32.png?v=abc", faviconDoer(func(req *http.Request) (*http.Response, error) {
		referer = req.Header.Get("Referer")
		userAgent = req.Header.Get("User-Agent")
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"image/png"}},
			Body:       io.NopCloser(strings.NewReader("png")),
			Request:    req,
		}, nil
	}))
	if err != nil {
		t.Fatalf("expected favicon fetch success, got %v", err)
	}
	if referer != "https://www.websoft9.com/" {
		t.Fatalf("expected origin referer, got %q", referer)
	}
	if !strings.Contains(userAgent, "AppOS favicon fetcher") {
		t.Fatalf("expected AppOS user-agent, got %q", userAgent)
	}
	if asset.ContentType != "image/png" || string(asset.Data) != "png" {
		t.Fatalf("unexpected asset: %#v", asset)
	}
}

func TestFetchFaviconRejectsNonImageContent(t *testing.T) {
	prepareFaviconCacheForTest(t)

	_, err := FetchFavicon(context.Background(), "https://example.com/favicon", faviconDoer(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"text/html; charset=utf-8"}},
			Body:       io.NopCloser(strings.NewReader("not an image")),
			Request:    req,
		}, nil
	}))
	if err == nil {
		t.Fatal("expected non-image favicon response to be rejected")
	}
}

func TestFetchFaviconUsesFreshCache(t *testing.T) {
	const rawURL = "https://example.com/favicon.png"
	prepareFaviconCacheForTest(t)

	var calls atomic.Int32
	first, err := FetchFavicon(context.Background(), rawURL, faviconDoer(func(req *http.Request) (*http.Response, error) {
		calls.Add(1)
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"image/png"}},
			Body:       io.NopCloser(strings.NewReader("png")),
			Request:    req,
		}, nil
	}))
	if err != nil {
		t.Fatalf("expected initial fetch success, got %v", err)
	}
	second, err := FetchFavicon(context.Background(), rawURL, faviconDoer(func(req *http.Request) (*http.Response, error) {
		calls.Add(1)
		return nil, io.EOF
	}))
	if err != nil {
		t.Fatalf("expected cached fetch success, got %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("expected only one remote fetch, got %d", calls.Load())
	}
	if string(first.Data) != string(second.Data) || first.ContentType != second.ContentType {
		t.Fatalf("expected cached favicon asset to match first fetch")
	}
}

func TestFetchFaviconFallsBackToStaleCacheOnRemoteFailure(t *testing.T) {
	const rawURL = "https://example.com/favicon-stale.png"
	prepareFaviconCacheForTest(t)
	setCachedFavicon(rawURL, FaviconAsset{ContentType: "image/png", Data: []byte("stale")}, time.Now().Add(-48*time.Hour))

	asset, err := FetchFavicon(context.Background(), rawURL, faviconDoer(func(req *http.Request) (*http.Response, error) {
		return nil, io.EOF
	}))
	if err != nil {
		t.Fatalf("expected stale cache fallback, got %v", err)
	}
	if string(asset.Data) != "stale" {
		t.Fatalf("expected stale cached favicon, got %q", string(asset.Data))
	}
}

func TestFetchFaviconUsesDiskCacheAcrossMemoryReset(t *testing.T) {
	const rawURL = "https://example.com/favicon-disk.png"
	prepareFaviconCacheForTest(t)

	var calls atomic.Int32
	first, err := FetchFavicon(context.Background(), rawURL, faviconDoer(func(req *http.Request) (*http.Response, error) {
		calls.Add(1)
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"image/png"}},
			Body:       io.NopCloser(strings.NewReader("diskpng")),
			Request:    req,
		}, nil
	}))
	if err != nil {
		t.Fatalf("expected initial disk-cache fetch success, got %v", err)
	}
	resetFaviconMemoryCacheForTest(t)

	second, err := FetchFavicon(context.Background(), rawURL, faviconDoer(func(req *http.Request) (*http.Response, error) {
		calls.Add(1)
		return nil, io.EOF
	}))
	if err != nil {
		t.Fatalf("expected disk-cached fetch success, got %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("expected only one remote fetch before disk cache reuse, got %d", calls.Load())
	}
	if string(first.Data) != string(second.Data) || first.ContentType != second.ContentType {
		t.Fatalf("expected disk-cached favicon asset to match first fetch")
	}
}

func prepareFaviconCacheForTest(t *testing.T) {
	t.Helper()
	t.Setenv("APPOS_FAVICON_CACHE_DIR", t.TempDir())
	resetFaviconMemoryCacheForTest(t)
}

func resetFaviconMemoryCacheForTest(t *testing.T) {
	t.Helper()
	faviconCache.mu.Lock()
	faviconCache.items = make(map[string]faviconCacheEntry)
	faviconCache.mu.Unlock()
}
