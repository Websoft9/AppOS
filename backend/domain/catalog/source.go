package catalog

import (
	"embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/websoft9/appos/backend/domain/runtimepaths"
)

//go:embed seed/*.json
var embeddedCatalogSeed embed.FS

var embeddedCatalogSeedFiles = []string{
	"catalog_en.json",
	"catalog_zh.json",
	"product_en.json",
	"product_zh.json",
}

type SourceCategory struct {
	Key        string   `json:"key"`
	Position   *float64 `json:"position"`
	Title      string   `json:"title"`
	LinkedFrom struct {
		CatalogCollection struct {
			Items []SourceSecondaryCategory `json:"items"`
		} `json:"catalogCollection"`
	} `json:"linkedFrom"`
}

type SourceSecondaryCategory struct {
	Key      string   `json:"key"`
	Title    string   `json:"title"`
	Position *float64 `json:"position"`
}

type SourceProduct struct {
	Sys struct {
		ID string `json:"id"`
	} `json:"sys"`
	Key         string `json:"key"`
	Hot         int    `json:"hot"`
	Trademark   string `json:"trademark"`
	Summary     string `json:"summary"`
	Overview    string `json:"overview"`
	Description string `json:"description"`
	WebsiteURL  string `json:"websiteurl"`
	VCpu        int    `json:"vcpu"`
	Memory      int    `json:"memory"`
	Storage     int    `json:"storage"`
	Screenshots []struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	} `json:"screenshots"`
	Logo struct {
		ImageURL string `json:"imageurl"`
	} `json:"logo"`
	CatalogCollection struct {
		Items []struct {
			Key               string `json:"key"`
			Title             string `json:"title"`
			CatalogCollection struct {
				Items []struct {
					Key   string `json:"key"`
					Title string `json:"title"`
				} `json:"items"`
			} `json:"catalogCollection"`
		} `json:"items"`
	} `json:"catalogCollection"`
}

type Bundle struct {
	Categories    []SourceCategory
	Products      []SourceProduct
	SourceVersion string
	Locale        string
}

func LoadBundle(locale string) (*Bundle, error) {
	storeDir, err := resolveStoreDir()
	if err != nil {
		return nil, err
	}

	catPath := filepath.Join(storeDir, fmt.Sprintf("catalog_%s.json", locale))
	prodPath := filepath.Join(storeDir, fmt.Sprintf("product_%s.json", locale))

	catData, err := os.ReadFile(catPath)
	if err != nil {
		return nil, fmt.Errorf("read catalog bundle: %w", err)
	}
	prodData, err := os.ReadFile(prodPath)
	if err != nil {
		return nil, fmt.Errorf("read product bundle: %w", err)
	}

	var categories []SourceCategory
	if err := json.Unmarshal(catData, &categories); err != nil {
		return nil, fmt.Errorf("parse catalog bundle: %w", err)
	}

	var products []SourceProduct
	if err := json.Unmarshal(prodData, &products); err != nil {
		return nil, fmt.Errorf("parse product bundle: %w", err)
	}

	return &Bundle{
		Categories:    categories,
		Products:      products,
		SourceVersion: latestModTimeRFC3339(catPath, prodPath),
		Locale:        locale,
	}, nil
}

func resolveStoreDir() (string, error) {
	if configured := strings.TrimSpace(os.Getenv("APPOS_CATALOG_STORE_PATH")); configured != "" {
		if err := ensureCatalogSeedDir(configured); err != nil {
			return "", err
		}
		return configured, nil
	}

	defaultDir := runtimepaths.CatalogDir()
	if err := ensureCatalogSeedDir(defaultDir); err != nil {
		return "", err
	}
	return defaultDir, nil
}

func ensureCatalogSeedDir(dir string) error {
	if strings.TrimSpace(dir) == "" {
		return fmt.Errorf("catalog store directory not configured")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create catalog store directory: %w", err)
	}
	for _, name := range embeddedCatalogSeedFiles {
		targetPath := filepath.Join(dir, name)
		if catalogSeedFileExists(targetPath) {
			continue
		}
		data, err := embeddedCatalogSeed.ReadFile(filepath.Join("seed", name))
		if err != nil {
			return fmt.Errorf("read embedded catalog seed %s: %w", name, err)
		}
		if err := writeCatalogSeedFile(targetPath, data); err != nil {
			return fmt.Errorf("write catalog seed %s: %w", name, err)
		}
	}
	return nil
}

func writeCatalogSeedFile(path string, data []byte) error {
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	return nil
}

func catalogSeedFileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func latestModTimeRFC3339(paths ...string) string {
	var latest time.Time
	for _, path := range paths {
		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		if info.ModTime().After(latest) {
			latest = info.ModTime()
		}
	}
	if latest.IsZero() {
		return ""
	}
	return latest.UTC().Format(time.RFC3339)
}
