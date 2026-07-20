package dockerops

import (
	"sync"
	"time"
)

const ImageListCacheTTL = 15 * time.Second

type ImageListCacheEntry struct {
	Output    string
	Host      string
	FetchedAt time.Time
}

var imageListCache = struct {
	mu      sync.RWMutex
	entries map[string]ImageListCacheEntry
}{
	entries: map[string]ImageListCacheEntry{},
}

func ImageListCacheKey(serverID, host string) string {
	if serverID != "" {
		return "server:" + serverID
	}
	return "host:" + host
}

func GetCachedImageList(key string) (ImageListCacheEntry, bool) {
	imageListCache.mu.RLock()
	entry, ok := imageListCache.entries[key]
	imageListCache.mu.RUnlock()
	if !ok || time.Since(entry.FetchedAt) > ImageListCacheTTL {
		if ok {
			InvalidateImageListCache(key)
		}
		return ImageListCacheEntry{}, false
	}
	return entry, true
}

func SetCachedImageList(key, output, host string) {
	imageListCache.mu.Lock()
	imageListCache.entries[key] = ImageListCacheEntry{
		Output:    output,
		Host:      host,
		FetchedAt: time.Now(),
	}
	imageListCache.mu.Unlock()
}

func InvalidateImageListCache(key string) {
	imageListCache.mu.Lock()
	delete(imageListCache.entries, key)
	imageListCache.mu.Unlock()
}
