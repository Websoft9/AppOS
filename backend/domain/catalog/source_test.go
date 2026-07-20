package catalog

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadBundleBootstrapsEmbeddedSeedIntoConfiguredRuntimeDir(t *testing.T) {
	runtimeDir := t.TempDir()
	t.Setenv("APPOS_CATALOG_STORE_PATH", runtimeDir)

	bundle, err := LoadBundle("en")
	if err != nil {
		t.Fatalf("expected embedded catalog seed bootstrap to succeed, got error: %v", err)
	}
	if bundle.Locale != "en" {
		t.Fatalf("expected locale en, got %q", bundle.Locale)
	}
	if len(bundle.Categories) == 0 {
		t.Fatalf("expected seeded categories, got none")
	}
	if len(bundle.Products) == 0 {
		t.Fatalf("expected seeded products, got none")
	}

	for _, name := range embeddedCatalogSeedFiles {
		path := filepath.Join(runtimeDir, name)
		if !catalogSeedFileExists(path) {
			t.Fatalf("expected seeded runtime file %s to exist", name)
		}
		content, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read seeded runtime file %s: %v", name, err)
		}
		if len(content) == 0 {
			t.Fatalf("expected seeded runtime file %s to be non-empty", name)
		}
	}
}
