package catalog

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

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
	if configured := strings.TrimSpace(os.Getenv("APPOS_CATALOG_STORE_PATH")); configured != "" && isReadableDir(configured) {
		return configured, nil
	}

	wd, _ := os.Getwd()
	candidates := []string{"/usr/share/nginx/html/web/store"}
	base := wd
	for range 6 {
		candidates = append(candidates,
			filepath.Join(base, "web", "public", "store"),
			filepath.Join(base, "web", "dist", "store"),
		)
		parent := filepath.Dir(base)
		if parent == base {
			break
		}
		base = parent
	}

	for _, candidate := range candidates {
		if isReadableDir(candidate) {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("catalog store directory not found")
}

func isReadableDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
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
