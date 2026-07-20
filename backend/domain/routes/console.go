package routes

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/runtimecfg"
)

func registerConsoleRoutes(se *core.ServeEvent) {
	se.Router.GET("/pb/admin", handleLegacyPocketBaseAdminRoot)
	se.Router.GET("/pb/admin/{path...}", handleLegacyPocketBaseAdmin)
	registerLegacyPocketBaseAPIRoutes(se, "/pb/api")
	registerLegacyPocketBaseAPIRoutes(se, "/pb/api/{path...}")

	se.Router.Any("/{$}", handleConsoleWeb)
	se.Router.Any("/{path...}", handleConsoleWeb)
}

func registerLegacyPocketBaseAPIRoutes(se *core.ServeEvent, routePath string) {
	se.Router.GET(routePath, handleLegacyPocketBaseAPI)
	se.Router.HEAD(routePath, handleLegacyPocketBaseAPI)
	se.Router.POST(routePath, handleLegacyPocketBaseAPI)
	se.Router.PUT(routePath, handleLegacyPocketBaseAPI)
	se.Router.PATCH(routePath, handleLegacyPocketBaseAPI)
	se.Router.DELETE(routePath, handleLegacyPocketBaseAPI)
	se.Router.OPTIONS(routePath, handleLegacyPocketBaseAPI)
}

func handleLegacyPocketBaseAdminRoot(e *core.RequestEvent) error {
	return redirectWithQuery(e, "/_/", http.StatusPermanentRedirect)
}

func handleLegacyPocketBaseAdmin(e *core.RequestEvent) error {
	pathValue := strings.TrimPrefix(strings.TrimSpace(e.Request.PathValue("path")), "/")
	target := "/_/"
	if pathValue != "" {
		target += pathValue
	}
	return redirectWithQuery(e, target, http.StatusPermanentRedirect)
}

func handleLegacyPocketBaseAPI(e *core.RequestEvent) error {
	pathValue := strings.TrimPrefix(strings.TrimSpace(e.Request.PathValue("path")), "/")
	target := "/api"
	if pathValue != "" {
		target += "/" + pathValue
	}
	return redirectWithQuery(e, target, http.StatusTemporaryRedirect)
}

func redirectWithQuery(e *core.RequestEvent, target string, status int) error {
	if e == nil || e.Request == nil {
		return nil
	}
	if raw := strings.TrimSpace(e.Request.URL.RawQuery); raw != "" {
		target += "?" + raw
	}
	http.Redirect(e.Response, e.Request, target, status)
	return nil
}

func handleConsoleWeb(e *core.RequestEvent) error {
	if e.Request.Method != http.MethodGet && e.Request.Method != http.MethodHead {
		return e.NotFoundError("console route not found", nil)
	}

	webRoot, ok := runtimecfg.ResolveWebRoot()
	if !ok {
		return e.JSON(http.StatusServiceUnavailable, map[string]any{
			"error":   "console_web_root_unavailable",
			"message": "AppOS web bundle is not available on this runtime",
		})
	}

	resolvedPath := resolveConsoleAssetPath(e.Request.PathValue("path"))
	if resolvedPath != "" {
		candidate := filepath.Join(webRoot, filepath.FromSlash(resolvedPath))
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			applyConsoleAssetHeaders(e.Response, resolvedPath, true)
			http.ServeFile(e.Response, e.Request, candidate)
			return nil
		}
	}

	indexPath := filepath.Join(webRoot, "index.html")
	if info, err := os.Stat(indexPath); err != nil || info.IsDir() {
		return e.JSON(http.StatusServiceUnavailable, map[string]any{
			"error":   "console_entry_unavailable",
			"message": "AppOS console entrypoint index.html is not available",
		})
	}

	applyConsoleAssetHeaders(e.Response, resolvedPath, false)
	http.ServeFile(e.Response, e.Request, indexPath)
	return nil
}

func resolveConsoleAssetPath(raw string) string {
	cleaned := path.Clean("/" + strings.TrimSpace(raw))
	cleaned = strings.TrimPrefix(cleaned, "/")
	if cleaned == "." {
		return ""
	}
	if cleaned == "" {
		return ""
	}
	parts := strings.Split(cleaned, "/")
	for _, part := range parts {
		if part == ".." {
			return ""
		}
	}
	return cleaned
}

func applyConsoleAssetHeaders(w http.ResponseWriter, resolvedPath string, isStaticFile bool) {
	if w == nil {
		return
	}
	w.Header().Set("X-Frame-Options", "SAMEORIGIN")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if isStaticFile && strings.HasPrefix(resolvedPath, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		return
	}
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
}
