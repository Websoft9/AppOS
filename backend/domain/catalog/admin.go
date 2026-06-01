package catalog

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const versionMarkerFileName = ".version"

func (s *Service) AdminStatus() (*AdminStatusResponse, error) {
	runtimeDir, err := resolveStoreDir()
	if err != nil {
		return nil, err
	}

	files := make([]AdminSourceFileStatus, 0, len(embeddedCatalogSeedFiles))
	for _, name := range embeddedCatalogSeedFiles {
		files = append(files, sourceFileStatus(runtimeDir, name))
	}

	locales := make([]AdminLocaleStatus, 0, 2)
	for _, locale := range []string{"en", "zh"} {
		bundle, err := LoadBundle(locale)
		if err != nil {
			return nil, fmt.Errorf("load %s catalog bundle: %w", locale, err)
		}
		locales = append(locales, AdminLocaleStatus{
			Locale:        locale,
			CategoryCount: len(bundle.Categories),
			ProductCount:  len(bundle.Products),
			SourceVersion: bundle.SourceVersion,
		})
	}
	sort.SliceStable(locales, func(i, j int) bool {
		return locales[i].Locale < locales[j].Locale
	})

	versionMarkerPath := filepath.Join(runtimeDir, versionMarkerFileName)
	syncReason := "remote artifact sync is not available yet; local runtime seed inspection only"

	return &AdminStatusResponse{
		RuntimeDir:    runtimeDir,
		Files:         files,
		Locales:       locales,
		VersionMarker: AdminVersionMarkerStatus{Path: versionMarkerPath, Exists: catalogSeedFileExists(versionMarkerPath)},
		SyncCapability: AdminSyncCapability{
			Available: false,
			Reason:    &syncReason,
		},
	}, nil
}

func (s *Service) AdminReindex() (*AdminReindexResponse, error) {
	status, err := s.AdminStatus()
	if err != nil {
		return nil, err
	}
	return &AdminReindexResponse{
		Ok:         true,
		RuntimeDir: status.RuntimeDir,
		Locales:    status.Locales,
	}, nil
}

func (s *Service) AdminRawCategories(locale string) (*AdminRawCategoriesResponse, error) {
	bundle, err := LoadBundle(locale)
	if err != nil {
		return nil, err
	}
	return &AdminRawCategoriesResponse{
		Items: bundle.Categories,
		Meta:  ResponseMeta{Locale: bundle.Locale, SourceVersion: bundle.SourceVersion},
	}, nil
}

func (s *Service) AdminRawApp(locale, key string) (*AdminRawAppResponse, error) {
	bundle, err := LoadBundle(locale)
	if err != nil {
		return nil, err
	}
	trimmedKey := strings.TrimSpace(key)
	for _, product := range bundle.Products {
		if strings.TrimSpace(product.Key) != trimmedKey {
			continue
		}
		return &AdminRawAppResponse{
			Item: product,
			Meta: ResponseMeta{Locale: bundle.Locale, SourceVersion: bundle.SourceVersion},
		}, nil
	}
	return nil, fmt.Errorf("catalog source app not found")
}

func sourceFileStatus(dir, name string) AdminSourceFileStatus {
	path := filepath.Join(dir, name)
	status := AdminSourceFileStatus{Name: name, Path: path}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return status
	}
	status.Exists = true
	status.SizeBytes = info.Size()
	status.ModifiedAt = info.ModTime().UTC().Format(time.RFC3339)
	return status
}