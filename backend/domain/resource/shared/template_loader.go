package shared

import (
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strings"
)

func LoadTemplates[T any, O any](
	templateFS fs.FS,
	readOverlay func(filePath string) (O, error),
	loadKindBase func(kind string) (T, error),
	mergeTemplate func(base T, overlay O, filePath string) (T, error),
	key func(template T) string,
) ([]T, error) {
	templateMap := make(map[string]T)

	entries, err := fs.ReadDir(templateFS, "templates")
	if err != nil {
		return nil, err
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		kind := entry.Name()
		base, err := loadKindBase(kind)
		if err != nil {
			return nil, err
		}

		kindEntries, err := fs.ReadDir(templateFS, path.Join("templates", kind))
		if err != nil {
			return nil, err
		}

		for _, kindEntry := range kindEntries {
			if !IsTemplateOverlayFile(kindEntry) {
				continue
			}

			filePath := path.Join("templates", kind, kindEntry.Name())
			overlay, err := readOverlay(filePath)
			if err != nil {
				return nil, err
			}

			template, err := mergeTemplate(base, overlay, filePath)
			if err != nil {
				return nil, err
			}
			templateKey := strings.TrimSpace(key(template))
			if templateKey == "" {
				return nil, fmt.Errorf("template key is empty for %s", filePath)
			}
			templateMap[templateKey] = template
		}
	}

	keys := make([]string, 0, len(templateMap))
	for templateKey := range templateMap {
		keys = append(keys, templateKey)
	}
	sort.Strings(keys)

	result := make([]T, 0, len(keys))
	for _, templateKey := range keys {
		result = append(result, templateMap[templateKey])
	}
	return result, nil
}

func IsTemplateOverlayFile(entry fs.DirEntry) bool {
	return !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") && entry.Name() != "_template.json"
}
