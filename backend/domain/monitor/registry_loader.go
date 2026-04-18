package monitor

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"
	"sync"
)

//go:embed all:targets
var embeddedTargetRegistryFiles embed.FS

var (
	targetRegistryOnce    sync.Once
	targetRegistryErr     error
	targetRegistryEntries []TargetRegistryEntry
)

func ensureTargetRegistryLoaded() error {
	targetRegistryOnce.Do(func() {
		targetRegistryErr = loadTargetRegistry()
	})
	return targetRegistryErr
}

func loadTargetRegistry() error {
	entries, err := fs.ReadDir(embeddedTargetRegistryFiles, "targets")
	if err != nil {
		return fmt.Errorf("read monitoring target registry: %w", err)
	}

	loaded := make([]TargetRegistryEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
			continue
		}

		filePath := path.Join("targets", entry.Name())
		content, err := embeddedTargetRegistryFiles.ReadFile(filePath)
		if err != nil {
			return fmt.Errorf("read monitoring target registry file %s: %w", filePath, err)
		}

		var fileEntries []TargetRegistryEntry
		if err := json.Unmarshal(content, &fileEntries); err != nil {
			return fmt.Errorf("parse monitoring target registry file %s: %w", filePath, err)
		}
		for _, item := range fileEntries {
			normalized, err := normalizeTargetRegistryEntry(item)
			if err != nil {
				return fmt.Errorf("invalid monitoring target registry file %s: %w", filePath, err)
			}
			loaded = append(loaded, normalized)
		}
	}

	sort.Slice(loaded, func(i, j int) bool {
		return loaded[i].ID < loaded[j].ID
	})
	targetRegistryEntries = loaded
	return nil
}
