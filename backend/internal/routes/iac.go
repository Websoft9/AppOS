// Package routes — IaC API (Epic 14: IaC File Management)
//
// All routes under /api/ext/iac, superuser-only.
// Story 14.1: List + Read (GET /, GET /content)
// Story 14.2: Write/Upload/Download (POST /, PUT /content, DELETE, POST /move, POST /upload, GET /download)
package routes

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/internal/fileutil"
	"github.com/websoft9/appos/backend/internal/settings"
)

const (
	filesBasePath       = "/appos/data"
	libraryBasePath     = "/appos/library"
	filesAllowedArchive = ".zip"
)

var (
	filesAllowedRoots   = []string{"apps", "workflows", "templates"}
	libraryAllowedRoots = []string{"apps"}

	// defaultFileSettings are the fallback values used when the "files" settings
	// group is absent from app_settings. All limits and the blacklist can be
	// overridden at runtime via the Settings API.
	defaultFileSettings = map[string]any{
		"maxSizeMB":          10,
		"maxZipSizeMB":       50,
		"extensionBlacklist": ".exe,.dll,.so,.bin,.deb,.rpm,.apk,.msi,.dmg,.pkg",
	}
)

// registerIaCRoutes mounts /api/ext/iac with superuser-only access.
func registerIaCRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	iac := g.Group("/iac")
	iac.Bind(apis.RequireSuperuserAuth())

	// Story 14.1
	iac.GET("", handleFileList)
	iac.GET("/content", handleFileRead)

	// Story 14.2
	iac.POST("", handleFileCreate)
	iac.PUT("/content", handleFileUpdate)
	iac.DELETE("", handleFileDelete)
	iac.POST("/move", handleFileMove)
	iac.POST("/upload", handleFileUpload)
	iac.GET("/download", handleFileDownload)

	// Story 5.5: Read-only access to /appos/library/apps/ for custom-app template pre-fill.
	iac.GET("/library", handleLibraryList)
	iac.GET("/library/content", handleLibraryRead)
	iac.POST("/library/copy", handleLibraryCopy)
}

// ─── GET /api/ext/iac?path=<rel> ────────────────────────────────────────────

type fileEntry struct {
	Name       string    `json:"name"`
	Type       string    `json:"type"` // "file" | "dir"
	Size       int64     `json:"size"`
	ModifiedAt time.Time `json:"modified_at"`
}

type listResponse struct {
	Path    string      `json:"path"`
	Entries []fileEntry `json:"entries"`
}

func handleFileList(e *core.RequestEvent) error {
	rel := e.Request.URL.Query().Get("path")

	abs, err := fileutil.ResolveSafePath(filesBasePath, rel, filesAllowedRoots)
	if err != nil {
		return apis.NewBadRequestError("invalid path", err)
	}

	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return apis.NewNotFoundError("path not found", nil)
		}
		return apis.NewBadRequestError("cannot stat path", err)
	}
	if !info.IsDir() {
		return apis.NewBadRequestError("path is not a directory", nil)
	}

	entries, err := os.ReadDir(abs)
	if err != nil {
		return apis.NewBadRequestError("cannot read directory", err)
	}

	// Sort: directories first, then alphabetical within each group.
	sort.Slice(entries, func(i, j int) bool {
		di, dj := entries[i].IsDir(), entries[j].IsDir()
		if di != dj {
			return di
		}
		return entries[i].Name() < entries[j].Name()
	})

	result := listResponse{
		Path:    rel,
		Entries: make([]fileEntry, 0, len(entries)),
	}
	for _, de := range entries {
		fi, err := de.Info()
		if err != nil {
			continue
		}
		typ := "file"
		if de.IsDir() {
			typ = "dir"
		}
		result.Entries = append(result.Entries, fileEntry{
			Name:       de.Name(),
			Type:       typ,
			Size:       fi.Size(),
			ModifiedAt: fi.ModTime().UTC(),
		})
	}

	return e.JSON(http.StatusOK, result)
}

// ─── GET /api/ext/iac/content?path=<rel> ────────────────────────────────────

type contentResponse struct {
	Path       string    `json:"path"`
	Content    string    `json:"content"`
	Size       int64     `json:"size"`
	ModifiedAt time.Time `json:"modified_at"`
}

func handleFileRead(e *core.RequestEvent) error {
	rel := e.Request.URL.Query().Get("path")

	abs, err := fileutil.ResolveSafePath(filesBasePath, rel, filesAllowedRoots)
	if err != nil {
		return apis.NewBadRequestError("invalid path", err)
	}

	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return apis.NewNotFoundError("file not found", nil)
		}
		return apis.NewBadRequestError("cannot stat file", err)
	}
	if info.IsDir() {
		return apis.NewBadRequestError("path is a directory", nil)
	}

	cfg, _ := settings.GetGroup(e.App, "files", "limits", defaultFileSettings)
	maxSizeMB := settings.Int(cfg, "maxSizeMB", 10)
	maxRead := int64(maxSizeMB) * 1024 * 1024

	if info.Size() > maxRead {
		return apis.NewApiError(http.StatusRequestEntityTooLarge,
			fmt.Sprintf("file exceeds %d MB limit", maxSizeMB), nil)
	}

	data, err := os.ReadFile(abs)
	if err != nil {
		return apis.NewBadRequestError("cannot read file", err)
	}

	mimeType := http.DetectContentType(data)
	if !isTextMIME(mimeType) {
		return apis.NewApiError(http.StatusUnsupportedMediaType,
			"binary files are not supported", nil)
	}

	return e.JSON(http.StatusOK, contentResponse{
		Path:       rel,
		Content:    string(data),
		Size:       info.Size(),
		ModifiedAt: info.ModTime().UTC(),
	})
}

// ─── POST /api/ext/iac ──────────────────────────────────────────────────────
// Body: {"path":"apps/myapp/docker-compose.yml","type":"file","content":"..."}
//
//	{"path":"apps/myapp","type":"dir"}
type createRequest struct {
	Path    string `json:"path"`
	Type    string `json:"type"`    // "file" (default) | "dir"
	Content string `json:"content"` // optional initial content for files
}

func handleFileCreate(e *core.RequestEvent) error {
	var req createRequest
	if err := e.BindBody(&req); err != nil {
		return apis.NewBadRequestError("invalid request body", err)
	}

	abs, err := fileutil.ResolveSafePath(filesBasePath, req.Path, filesAllowedRoots)
	if err != nil {
		return apis.NewBadRequestError("invalid path", err)
	}

	if _, err := os.Stat(abs); err == nil {
		return apis.NewApiError(http.StatusConflict, "path already exists", nil)
	}

	if req.Type == "dir" {
		if err := os.MkdirAll(abs, 0o755); err != nil {
			return apis.NewBadRequestError("cannot create directory", err)
		}
		return e.JSON(http.StatusCreated, map[string]string{
			"path": req.Path,
			"type": "dir",
		})
	}

	// Default: create a file.
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return apis.NewBadRequestError("cannot create parent directories", err)
	}
	if err := os.WriteFile(abs, []byte(req.Content), 0o644); err != nil {
		return apis.NewBadRequestError("cannot write file", err)
	}
	return e.JSON(http.StatusCreated, map[string]string{
		"path": req.Path,
		"type": "file",
	})
}

// ─── PUT /api/ext/iac/content ───────────────────────────────────────────────
// Body: {"path":"apps/myapp/docker-compose.yml","content":"..."}

type updateRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

func handleFileUpdate(e *core.RequestEvent) error {
	var req updateRequest
	if err := e.BindBody(&req); err != nil {
		return apis.NewBadRequestError("invalid request body", err)
	}

	abs, err := fileutil.ResolveSafePath(filesBasePath, req.Path, filesAllowedRoots)
	if err != nil {
		return apis.NewBadRequestError("invalid path", err)
	}

	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return apis.NewNotFoundError("file not found", nil)
		}
		return apis.NewBadRequestError("cannot stat file", err)
	}
	if info.IsDir() {
		return apis.NewBadRequestError("path is a directory", nil)
	}

	if err := os.WriteFile(abs, []byte(req.Content), 0o644); err != nil {
		return apis.NewBadRequestError("cannot write file", err)
	}
	return e.JSON(http.StatusOK, map[string]string{
		"path": req.Path,
	})
}

// ─── DELETE /api/ext/iac?path=<rel>&recursive=true ──────────────────────────

func handleFileDelete(e *core.RequestEvent) error {
	rel := e.Request.URL.Query().Get("path")
	recursive := e.Request.URL.Query().Get("recursive") == "true"

	// Block deletion of top-level root directories (apps, workflows, templates).
	if rootOf(rel) == rel {
		return apis.NewBadRequestError("cannot delete a root directory", nil)
	}

	abs, err := fileutil.ResolveSafePath(filesBasePath, rel, filesAllowedRoots)
	if err != nil {
		return apis.NewBadRequestError("invalid path", err)
	}

	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return apis.NewNotFoundError("path not found", nil)
		}
		return apis.NewBadRequestError("cannot stat path", err)
	}

	if info.IsDir() {
		if !recursive {
			return apis.NewBadRequestError("path is a directory; set recursive=true to delete", nil)
		}
		if err := os.RemoveAll(abs); err != nil {
			return apis.NewBadRequestError("cannot delete directory", err)
		}
	} else {
		if err := os.Remove(abs); err != nil {
			return apis.NewBadRequestError("cannot delete file", err)
		}
	}

	return e.JSON(http.StatusOK, map[string]string{"path": rel})
}

// ─── POST /api/ext/iac/move ─────────────────────────────────────────────────
// Body: {"from":"apps/a/file.yml","to":"apps/b/file.yml"}

type moveRequest struct {
	From string `json:"from"`
	To   string `json:"to"`
}

func handleFileMove(e *core.RequestEvent) error {
	var req moveRequest
	if err := e.BindBody(&req); err != nil {
		return apis.NewBadRequestError("invalid request body", err)
	}

	fromAbs, err := fileutil.ResolveSafePath(filesBasePath, req.From, filesAllowedRoots)
	if err != nil {
		return apis.NewBadRequestError("invalid 'from' path", err)
	}
	toAbs, err := fileutil.ResolveSafePath(filesBasePath, req.To, filesAllowedRoots)
	if err != nil {
		return apis.NewBadRequestError("invalid 'to' path", err)
	}

	// Disallow cross-root moves (e.g. apps/ → workflows/).
	if rootOf(req.From) != rootOf(req.To) {
		return apis.NewBadRequestError("cross-root moves are not allowed", nil)
	}

	if _, err := os.Stat(fromAbs); err != nil {
		if os.IsNotExist(err) {
			return apis.NewNotFoundError("source path not found", nil)
		}
		return apis.NewBadRequestError("cannot stat source", err)
	}
	if _, err := os.Stat(toAbs); err == nil {
		return apis.NewApiError(http.StatusConflict, "destination already exists", nil)
	}

	if err := os.MkdirAll(filepath.Dir(toAbs), 0o755); err != nil {
		return apis.NewBadRequestError("cannot create destination parent directories", err)
	}
	if err := os.Rename(fromAbs, toAbs); err != nil {
		return apis.NewBadRequestError("cannot move path", err)
	}

	return e.JSON(http.StatusOK, map[string]string{
		"from": req.From,
		"to":   req.To,
	})
}

// ─── POST /api/ext/iac/upload ───────────────────────────────────────────────
// multipart/form-data fields: file (file), path (string, target directory)

func handleFileUpload(e *core.RequestEvent) error {
	cfg, _ := settings.GetGroup(e.App, "files", "limits", defaultFileSettings)
	maxSizeMB := int64(settings.Int(cfg, "maxSizeMB", 10))
	maxZipSizeMB := int64(settings.Int(cfg, "maxZipSizeMB", 50))
	blacklist := settings.String(cfg, "extensionBlacklist", ".exe,.dll,.so,.bin,.deb,.rpm,.apk,.msi,.dmg,.pkg")

	// Parse multipart; cap memory at max zip size + 1 MB overhead.
	const overhead = 1 << 20
	if err := e.Request.ParseMultipartForm((maxZipSizeMB+1)*1024*1024 + overhead); err != nil {
		return apis.NewBadRequestError("cannot parse multipart form", err)
	}

	dirRel := e.Request.FormValue("path")
	dirAbs, err := fileutil.ResolveSafePath(filesBasePath, dirRel, filesAllowedRoots)
	if err != nil {
		return apis.NewBadRequestError("invalid path", err)
	}

	fh, header, err := e.Request.FormFile("file")
	if err != nil {
		return apis.NewBadRequestError("missing 'file' field", err)
	}
	defer fh.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	isZip := ext == filesAllowedArchive

	// Determine size limit for this file type.
	limitBytes := maxSizeMB * 1024 * 1024
	if isZip {
		limitBytes = maxZipSizeMB * 1024 * 1024
	}

	// Early rejection using reported header size (fast path; may be -1 for streamed uploads).
	if header.Size > 0 && header.Size > limitBytes {
		limitMB := maxSizeMB
		if isZip {
			limitMB = maxZipSizeMB
		}
		return apis.NewApiError(http.StatusRequestEntityTooLarge,
			fmt.Sprintf("file exceeds %d MB limit", limitMB), nil)
	}

	// Extension blacklist (upload only; zip files are never blacklisted).
	if !isZip && blacklist != "" {
		for _, blocked := range strings.Split(blacklist, ",") {
			if strings.TrimSpace(blocked) == ext {
				return apis.NewApiError(http.StatusUnsupportedMediaType,
					fmt.Sprintf("file extension %q is not allowed", ext), nil)
			}
		}
	}

	baseName := filepath.Base(header.Filename)
	if baseName == "" || baseName == "." || baseName == ".." {
		return apis.NewBadRequestError("invalid upload filename", nil)
	}

	if err := os.MkdirAll(dirAbs, 0o755); err != nil {
		return apis.NewBadRequestError("cannot create target directory", err)
	}
	destAbs := filepath.Join(dirAbs, baseName)
	destRel := filepath.ToSlash(filepath.Join(dirRel, baseName))

	out, err := os.Create(destAbs)
	if err != nil {
		return apis.NewBadRequestError("cannot create destination file", err)
	}
	defer out.Close()

	// Stream via LimitReader to enforce the byte limit regardless of what the
	// client reports in Content-Length / header.Size.
	written, copyErr := io.Copy(out, io.LimitReader(fh, limitBytes+1))
	if copyErr != nil {
		os.Remove(destAbs) //nolint:errcheck
		return apis.NewBadRequestError("cannot write uploaded file", copyErr)
	}
	if written > limitBytes {
		out.Close()
		os.Remove(destAbs) //nolint:errcheck
		limitMB := maxSizeMB
		if isZip {
			limitMB = maxZipSizeMB
		}
		return apis.NewApiError(http.StatusRequestEntityTooLarge,
			fmt.Sprintf("file exceeds %d MB limit", limitMB), nil)
	}
	if err := out.Sync(); err != nil {
		return apis.NewBadRequestError("cannot sync uploaded file", err)
	}

	return e.JSON(http.StatusCreated, map[string]string{
		"path": destRel,
	})
}

// ─── GET /api/ext/iac/download?path=<rel> ───────────────────────────────────

func handleFileDownload(e *core.RequestEvent) error {
	rel := e.Request.URL.Query().Get("path")

	abs, err := fileutil.ResolveSafePath(filesBasePath, rel, filesAllowedRoots)
	if err != nil {
		return apis.NewBadRequestError("invalid path", err)
	}

	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return apis.NewNotFoundError("file not found", nil)
		}
		return apis.NewBadRequestError("cannot stat file", err)
	}
	if info.IsDir() {
		return apis.NewBadRequestError("path is a directory; download a specific file", nil)
	}

	filename := filepath.Base(abs)
	e.Response.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename=%q`, filename))
	http.ServeFile(e.Response, e.Request, abs)

	return nil
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// isTextMIME returns true for MIME types representing plain text or known
// text-based formats detected by http.DetectContentType.
func isTextMIME(mime string) bool {
	textPrefixes := []string{
		"text/",
		"application/json",
		"application/xml",
		"application/javascript",
	}
	for _, p := range textPrefixes {
		if strings.HasPrefix(mime, p) {
			return true
		}
	}
	return false
}

// rootOf returns the first path segment of a slash-separated relative path,
// used to detect cross-root moves. e.g. "apps/myapp/file.yml" → "apps".
func rootOf(rel string) string {
	clean := filepath.ToSlash(filepath.Clean(rel))
	parts := strings.SplitN(clean, "/", 2)
	return parts[0]
}

// ─── GET /api/ext/iac/library?path=<rel> ────────────────────────────────────
// Read-only directory listing under /appos/library/.
// Allowed roots: "apps" only. Used by "Based on existing app" custom-app flow.
func handleLibraryList(e *core.RequestEvent) error {
	rel := e.Request.URL.Query().Get("path")

	abs, err := fileutil.ResolveSafePath(libraryBasePath, rel, libraryAllowedRoots)
	if err != nil {
		return apis.NewBadRequestError("invalid path", err)
	}

	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return apis.NewNotFoundError("path not found", nil)
		}
		return apis.NewBadRequestError("cannot stat path", err)
	}
	if !info.IsDir() {
		return apis.NewBadRequestError("path is not a directory", nil)
	}

	entries, err := os.ReadDir(abs)
	if err != nil {
		return apis.NewBadRequestError("cannot read directory", err)
	}

	sort.Slice(entries, func(i, j int) bool {
		di, dj := entries[i].IsDir(), entries[j].IsDir()
		if di != dj {
			return di
		}
		return entries[i].Name() < entries[j].Name()
	})

	result := listResponse{
		Path:    rel,
		Entries: make([]fileEntry, 0, len(entries)),
	}
	for _, de := range entries {
		fi, err := de.Info()
		if err != nil {
			continue
		}
		typ := "file"
		if de.IsDir() {
			typ = "dir"
		}
		result.Entries = append(result.Entries, fileEntry{
			Name:       de.Name(),
			Type:       typ,
			Size:       fi.Size(),
			ModifiedAt: fi.ModTime().UTC(),
		})
	}

	return e.JSON(http.StatusOK, result)
}

// ─── GET /api/ext/iac/library/content?path=<rel> ────────────────────────────
// Read-only file content from /appos/library/.
func handleLibraryRead(e *core.RequestEvent) error {
	rel := e.Request.URL.Query().Get("path")

	abs, err := fileutil.ResolveSafePath(libraryBasePath, rel, libraryAllowedRoots)
	if err != nil {
		return apis.NewBadRequestError("invalid path", err)
	}

	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return apis.NewNotFoundError("file not found", nil)
		}
		return apis.NewBadRequestError("cannot stat file", err)
	}
	if info.IsDir() {
		return apis.NewBadRequestError("path is a directory", nil)
	}

	cfg, _ := settings.GetGroup(e.App, "files", "limits", defaultFileSettings)
	maxSizeMB := settings.Int(cfg, "maxSizeMB", 10)
	maxRead := int64(maxSizeMB) * 1024 * 1024

	if info.Size() > maxRead {
		return apis.NewApiError(http.StatusRequestEntityTooLarge,
			fmt.Sprintf("file exceeds %d MB limit", maxSizeMB), nil)
	}

	data, err := os.ReadFile(abs)
	if err != nil {
		return apis.NewBadRequestError("cannot read file", err)
	}

	mimeType := http.DetectContentType(data)
	if !isTextMIME(mimeType) {
		return apis.NewApiError(http.StatusUnsupportedMediaType,
			"binary files are not supported", nil)
	}

	return e.JSON(http.StatusOK, contentResponse{
		Path:       rel,
		Content:    string(data),
		Size:       info.Size(),
		ModifiedAt: info.ModTime().UTC(),
	})
}

// ─── POST /api/ext/iac/library/copy ─────────────────────────────────────────
// Copy library/apps/{sourceKey}/ → data/templates/apps/{destKey}/.
// Body: {"sourceKey": "wordpress", "destKey": "my-wordpress"}
func handleLibraryCopy(e *core.RequestEvent) error {
	var req struct {
		SourceKey string `json:"sourceKey"`
		DestKey   string `json:"destKey"`
	}
	if err := e.BindBody(&req); err != nil {
		return apis.NewBadRequestError("invalid request body", err)
	}
	if req.SourceKey == "" {
		return apis.NewBadRequestError("sourceKey is required", nil)
	}
	if req.DestKey == "" {
		req.DestKey = req.SourceKey
	}

	// Validate source exists in library.
	srcRel := "apps/" + req.SourceKey
	srcAbs, err := fileutil.ResolveSafePath(libraryBasePath, srcRel, libraryAllowedRoots)
	if err != nil {
		return apis.NewBadRequestError("invalid sourceKey", err)
	}
	info, err := os.Stat(srcAbs)
	if err != nil || !info.IsDir() {
		return apis.NewNotFoundError("library app not found", nil)
	}

	// Destination under data/templates/apps/{destKey}.
	dstRel := "templates/apps/" + req.DestKey
	dstAbs, err := fileutil.ResolveSafePath(filesBasePath, dstRel, filesAllowedRoots)
	if err != nil {
		return apis.NewBadRequestError("invalid destination", err)
	}

	// Copy directory tree.
	if err := fileutil.CopyDir(srcAbs, dstAbs); err != nil {
		return apis.NewBadRequestError("failed to copy library app", err)
	}

	return e.JSON(http.StatusOK, map[string]string{
		"source":      srcRel,
		"destination": dstRel,
	})
}