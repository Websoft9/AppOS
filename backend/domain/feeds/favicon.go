package feeds

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/websoft9/appos/backend/domain/runtimepaths"
	"github.com/websoft9/appos/backend/infra/egress"
)

const maxFaviconFetchBytes int64 = 256 * 1024
const faviconCacheTTL = 24 * time.Hour

// faviconClient is a package-level SSRF-safe HTTP client reused across all
// uncached favicon fetches so connections can be pooled and reused.
// 10 s total timeout is generous for a small icon image.
var faviconClient = func() *http.Client {
	c, err := egress.NewFetchHTTPClient(nil, "download.general", 3*time.Second, false)
	if err != nil {
		fallback := egress.NewDirectHTTPClient(3*time.Second, false)
		return &fallback
	}
	return &c
}()

type FaviconAsset struct {
	ContentType string
	Data        []byte
}

type faviconCacheEntry struct {
	asset     FaviconAsset
	fetchedAt time.Time
}

type faviconDiskMeta struct {
	ContentType string    `json:"content_type"`
	FetchedAt   time.Time `json:"fetched_at"`
}

var faviconCache = struct {
	mu    sync.RWMutex
	items map[string]faviconCacheEntry
}{
	items: make(map[string]faviconCacheEntry),
}

func FetchFavicon(ctx context.Context, rawURL string, client HTTPDoer) (FaviconAsset, error) {
	trimmedURL := strings.TrimSpace(rawURL)
	parsedURL, err := egress.ValidateFetchURL(trimmedURL)
	if err != nil {
		return FaviconAsset{}, err
	}
	now := time.Now()
	if cached, ok := getCachedFavicon(trimmedURL, now); ok {
		return cached, nil
	}
	if cached, ok := getDiskCachedFavicon(trimmedURL, now, false); ok {
		setCachedFavicon(trimmedURL, cached, now)
		return cached, nil
	}
	if client == nil {
		client = faviconClient
	}
	if ctx == nil {
		ctx = context.Background()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsedURL.String(), nil)
	if err != nil {
		return FaviconAsset{}, fmt.Errorf("build favicon request: %w", err)
	}
	req.Header.Set("Accept", "image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8")
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; AppOS favicon fetcher)")
	req.Header.Set("Referer", parsedURL.Scheme+"://"+parsedURL.Host+"/")

	resp, err := client.Do(req)
	if err != nil {
		if cached, ok := getAnyCachedFavicon(trimmedURL); ok {
			return cached, nil
		}
		if cached, ok := getDiskCachedFavicon(trimmedURL, now, true); ok {
			setCachedFavicon(trimmedURL, cached, now)
			return cached, nil
		}
		return FaviconAsset{}, fmt.Errorf("fetch favicon: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		if cached, ok := getAnyCachedFavicon(trimmedURL); ok {
			return cached, nil
		}
		if cached, ok := getDiskCachedFavicon(trimmedURL, now, true); ok {
			setCachedFavicon(trimmedURL, cached, now)
			return cached, nil
		}
		return FaviconAsset{}, fmt.Errorf("favicon returned HTTP %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, maxFaviconFetchBytes+1))
	if err != nil {
		return FaviconAsset{}, fmt.Errorf("read favicon: %w", err)
	}
	if int64(len(data)) > maxFaviconFetchBytes {
		return FaviconAsset{}, fmt.Errorf("favicon exceeded %d byte limit", maxFaviconFetchBytes)
	}

	contentType := normalizeFaviconContentType(resp.Header.Get("Content-Type"), data)
	if !strings.HasPrefix(contentType, "image/") {
		if cached, ok := getAnyCachedFavicon(trimmedURL); ok {
			return cached, nil
		}
		if cached, ok := getDiskCachedFavicon(trimmedURL, now, true); ok {
			setCachedFavicon(trimmedURL, cached, now)
			return cached, nil
		}
		return FaviconAsset{}, fmt.Errorf("favicon content type %q is not an image", contentType)
	}

	asset := FaviconAsset{ContentType: contentType, Data: data}
	setCachedFavicon(trimmedURL, asset, now)
	_ = setDiskCachedFavicon(trimmedURL, asset, now)
	return asset, nil
}

func getCachedFavicon(rawURL string, now time.Time) (FaviconAsset, bool) {
	faviconCache.mu.RLock()
	entry, ok := faviconCache.items[rawURL]
	faviconCache.mu.RUnlock()
	if !ok {
		return FaviconAsset{}, false
	}
	if now.Sub(entry.fetchedAt) > faviconCacheTTL {
		return FaviconAsset{}, false
	}
	return cloneFaviconAsset(entry.asset), true
}

func getAnyCachedFavicon(rawURL string) (FaviconAsset, bool) {
	faviconCache.mu.RLock()
	entry, ok := faviconCache.items[rawURL]
	faviconCache.mu.RUnlock()
	if !ok {
		return FaviconAsset{}, false
	}
	return cloneFaviconAsset(entry.asset), true
}

func setCachedFavicon(rawURL string, asset FaviconAsset, fetchedAt time.Time) {
	faviconCache.mu.Lock()
	faviconCache.items[rawURL] = faviconCacheEntry{asset: cloneFaviconAsset(asset), fetchedAt: fetchedAt}
	faviconCache.mu.Unlock()
}

func cloneFaviconAsset(asset FaviconAsset) FaviconAsset {
	cloned := FaviconAsset{ContentType: asset.ContentType}
	if len(asset.Data) > 0 {
		cloned.Data = append([]byte(nil), asset.Data...)
	}
	return cloned
}

func getDiskCachedFavicon(rawURL string, now time.Time, allowStale bool) (FaviconAsset, bool) {
	bodyPath, metaPath := faviconCachePaths(rawURL)
	metaData, err := os.ReadFile(metaPath)
	if err != nil {
		return FaviconAsset{}, false
	}
	var meta faviconDiskMeta
	if err := json.Unmarshal(metaData, &meta); err != nil {
		return FaviconAsset{}, false
	}
	if !allowStale && now.Sub(meta.FetchedAt) > faviconCacheTTL {
		return FaviconAsset{}, false
	}
	body, err := os.ReadFile(bodyPath)
	if err != nil {
		return FaviconAsset{}, false
	}
	asset := FaviconAsset{ContentType: strings.TrimSpace(meta.ContentType), Data: body}
	if asset.ContentType == "" {
		asset.ContentType = normalizeFaviconContentType("", body)
	}
	if !strings.HasPrefix(asset.ContentType, "image/") {
		return FaviconAsset{}, false
	}
	return asset, true
}

func setDiskCachedFavicon(rawURL string, asset FaviconAsset, fetchedAt time.Time) error {
	bodyPath, metaPath := faviconCachePaths(rawURL)
	if err := os.MkdirAll(filepath.Dir(bodyPath), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(bodyPath, asset.Data, 0o600); err != nil {
		return err
	}
	metaData, err := json.Marshal(faviconDiskMeta{ContentType: asset.ContentType, FetchedAt: fetchedAt})
	if err != nil {
		return err
	}
	return os.WriteFile(metaPath, metaData, 0o600)
}

func faviconCachePaths(rawURL string) (string, string) {
	cacheKey := sha256.Sum256([]byte(strings.TrimSpace(rawURL)))
	baseName := hex.EncodeToString(cacheKey[:])
	baseDir := os.Getenv("APPOS_FAVICON_CACHE_DIR")
	if strings.TrimSpace(baseDir) == "" {
		baseDir = runtimepaths.FaviconCacheDir()
	}
	return filepath.Join(baseDir, baseName+".bin"), filepath.Join(baseDir, baseName+".json")
}

func normalizeFaviconContentType(header string, data []byte) string {
	contentType := strings.TrimSpace(header)
	if parsed, _, err := mime.ParseMediaType(contentType); err == nil {
		contentType = parsed
	}
	contentType = strings.ToLower(strings.TrimSpace(contentType))
	if strings.HasPrefix(contentType, "image/") {
		return contentType
	}
	return strings.ToLower(http.DetectContentType(data))
}
