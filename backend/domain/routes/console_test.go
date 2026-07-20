package routes

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/runtimecfg"
)

func TestConsoleRoutesServeIndexAndAssets(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	webDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(webDir, "index.html"), []byte("<html><body>appos console</body></html>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(webDir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(webDir, "assets", "app.js"), []byte("console.log('appos')"), 0o600); err != nil {
		t.Fatal(err)
	}

	original := runtimecfg.Get()
	cfg := original
	cfg.WebDir = webDir
	runtimecfg.Set(cfg)
	t.Cleanup(func() {
		runtimecfg.Set(original)
	})

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}
	registerConsoleRoutes(&core.ServeEvent{Router: r})
	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	rootReq := httptest.NewRequest(http.MethodGet, "/", nil)
	rootRec := httptest.NewRecorder()
	mux.ServeHTTP(rootRec, rootReq)
	if rootRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for root, got %d: %s", rootRec.Code, rootRec.Body.String())
	}
	if got := rootRec.Header().Get("Cache-Control"); got != "no-cache, no-store, must-revalidate" {
		t.Fatalf("expected no-cache header for shell, got %q", got)
	}
	if body := rootRec.Body.String(); body != "<html><body>appos console</body></html>" {
		t.Fatalf("unexpected root body %q", body)
	}

	assetReq := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
	assetRec := httptest.NewRecorder()
	mux.ServeHTTP(assetRec, assetReq)
	if assetRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for asset, got %d: %s", assetRec.Code, assetRec.Body.String())
	}
	if got := assetRec.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("expected immutable header for asset, got %q", got)
	}
	if body := assetRec.Body.String(); body != "console.log('appos')" {
		t.Fatalf("unexpected asset body %q", body)
	}

	spaReq := httptest.NewRequest(http.MethodGet, "/resources/servers", nil)
	spaRec := httptest.NewRecorder()
	mux.ServeHTTP(spaRec, spaReq)
	if spaRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for SPA fallback, got %d: %s", spaRec.Code, spaRec.Body.String())
	}
	if body := spaRec.Body.String(); body != "<html><body>appos console</body></html>" {
		t.Fatalf("unexpected spa fallback body %q", body)
	}
}

func TestConsoleRoutesRedirectLegacyPocketBasePaths(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}
	registerConsoleRoutes(&core.ServeEvent{Router: r})
	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	adminReq := httptest.NewRequest(http.MethodGet, "/pb/admin/collections?tab=data", nil)
	adminRec := httptest.NewRecorder()
	mux.ServeHTTP(adminRec, adminReq)
	if adminRec.Code != http.StatusPermanentRedirect {
		t.Fatalf("expected 308 for legacy admin path, got %d", adminRec.Code)
	}
	if location := adminRec.Header().Get("Location"); location != "/_/collections?tab=data" {
		t.Fatalf("expected admin redirect target, got %q", location)
	}

	apiReq := httptest.NewRequest(http.MethodPost, "/pb/api/health?source=legacy", nil)
	apiRec := httptest.NewRecorder()
	mux.ServeHTTP(apiRec, apiReq)
	if apiRec.Code != http.StatusTemporaryRedirect {
		t.Fatalf("expected 307 for legacy api path, got %d", apiRec.Code)
	}
	if location := apiRec.Header().Get("Location"); location != "/api/health?source=legacy" {
		t.Fatalf("expected api redirect target, got %q", location)
	}
}
