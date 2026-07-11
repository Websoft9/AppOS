package runtimepaths

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/websoft9/appos/backend/domain/runtimecfg"
)

const (
	DefaultDataRoot    = "/appos/data"
	DefaultLibraryRoot = "/appos/library"
	DefaultSystemRoot  = "/appos/system"

	DataRootEnv    = "APPOS_DATA_ROOT"
	LibraryRootEnv = "APPOS_LIBRARY_ROOT"
	SystemRootEnv  = "APPOS_SYSTEM_ROOT"

	LegacyDataRootEnv = "DATA_DIR"
)

func DataRoot() string {
	if configured := strings.TrimSpace(os.Getenv(DataRootEnv)); configured != "" {
		return filepath.Clean(configured)
	}
	if configured := strings.TrimSpace(runtimecfg.DataDir()); configured != "" {
		return filepath.Clean(configured)
	}
	if configured := strings.TrimSpace(os.Getenv(LegacyDataRootEnv)); configured != "" {
		return filepath.Clean(configured)
	}
	return DefaultDataRoot
}

func LibraryRoot() string {
	if configured := strings.TrimSpace(os.Getenv(LibraryRootEnv)); configured != "" {
		return filepath.Clean(configured)
	}
	return DefaultLibraryRoot
}

func SystemRoot() string {
	if configured := strings.TrimSpace(os.Getenv(SystemRootEnv)); configured != "" {
		return filepath.Clean(configured)
	}
	return DefaultSystemRoot
}

func AssetsDir() string {
	return filepath.Join(DataRoot(), "assets")
}

func MediaDir() string {
	return filepath.Join(DataRoot(), "media")
}

func CatalogDir() string {
	return filepath.Join(DataRoot(), "catalog")
}

func FaviconCacheDir() string {
	return filepath.Join(DataRoot(), "cache", "favicons")
}

func OperationsAppsDir() string {
	return filepath.Join(DataRoot(), "apps", "operations")
}

func ManagedCronRegistryPath() string {
	return filepath.Join(DataRoot(), "system", "crontab", "managed-registry.json")
}

func RuntimeTemplateAppsDir() string {
	return filepath.Join(DataRoot(), "templates", "apps")
}

func CustomTemplateAppsDir() string {
	return filepath.Join(DataRoot(), "templates", "custom", "apps")
}

func OfficialTemplateAppsDir() string {
	return filepath.Join(DataRoot(), "templates", "official", "apps")
}

func SystemOfficialTemplateAppsDir() string {
	return filepath.Join(SystemRoot(), "templates", "official", "apps")
}

func LibraryTemplateAppsDir() string {
	return filepath.Join(LibraryRoot(), "templates", "apps")
}

func LibraryAppsDir() string {
	return filepath.Join(LibraryRoot(), "apps")
}

func TemplateAppRoots() []string {
	return []string{
		RuntimeTemplateAppsDir(),
		CustomTemplateAppsDir(),
		OfficialTemplateAppsDir(),
		SystemOfficialTemplateAppsDir(),
		LibraryTemplateAppsDir(),
		LibraryAppsDir(),
	}
}
