// Package routes — IaC API (Epic 14: IaC File Management)
//
// All routes under /api/ext/iac, superuser-only.
// Story 14.1: List + Read (GET /, GET /content)
// Story 14.2: Write/Upload/Download (POST /, PUT /content, DELETE, POST /move, POST /upload, GET /download)
package routes

import (
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/domain/iac"
	"github.com/websoft9/appos/backend/infra/filesvc"
)

var (
	// filesBasePath remains package-visible temporarily because other route helpers
	// and tests still reference it during the first refactor phase.
	filesBasePath    = iac.WorkspaceBasePath
	iacLocalFiles     = mustNewLocalFilesService("iac", iac.WorkspaceBasePath, iac.WorkspaceRoots(), false)
	libraryLocalFiles = mustNewLocalFilesService("iac-library", iac.LibraryBasePath, iac.LibraryRoots(), true)
)

func mustNewLocalFilesService(name, basePath string, allowedRoots []string, readOnly bool) *filesvc.LocalService {
	svc, err := filesvc.NewLocal(filesvc.Config{
		Name:         name,
		BasePath:     basePath,
		AllowedRoots: allowedRoots,
		ReadOnly:     readOnly,
	})
	if err != nil {
		panic(err)
	}
	return svc
}

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

// handleFileList lists files and directories under a given IaC path.
//
// @Summary List IaC directory
// @Description Returns a sorted directory listing under /appos/data (dirs first). Superuser only.
// @Tags IaC
// @Security BearerAuth
// @Param path query string false "relative path (e.g. apps/myapp); defaults to root"
// @Success 200 {object} listResponse
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/ext/iac [get]
func handleFileList(e *core.RequestEvent) error {
	rel := e.Request.URL.Query().Get("path")

	entries, err := iacLocalFiles.List(rel)
	if err != nil {
		return iacPathError("invalid path", "path not found", "path is not a directory", err)
	}

	result := listResponse{
		Path:    rel,
		Entries: make([]fileEntry, 0, len(entries)),
	}
	for _, entry := range entries {
		result.Entries = append(result.Entries, toIACFileEntry(entry))
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

// handleFileRead reads the text content of a single IaC file.
//
// @Summary Read IaC file content
// @Description Returns the UTF-8 text content of a file under /appos/data. Binary files are rejected. Superuser only.
// @Tags IaC
// @Security BearerAuth
// @Param path query string true "relative file path (e.g. apps/myapp/docker-compose.yml)"
// @Success 200 {object} contentResponse
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 413 {object} map[string]any
// @Failure 415 {object} map[string]any
// @Router /api/ext/iac/content [get]
func handleFileRead(e *core.RequestEvent) error {
	rel := e.Request.URL.Query().Get("path")

	data, entry, err := iacLocalFiles.ReadFile(rel)
	if err != nil {
		return iacPathError("invalid path", "file not found", "path is a directory", err)
	}

	limits := iac.GetLimits(e.App)
	maxSizeMB := limits.MaxSizeMB
	maxRead := int64(maxSizeMB) * 1024 * 1024

	if entry.Size > maxRead {
		return apis.NewApiError(http.StatusRequestEntityTooLarge,
			fmt.Sprintf("file exceeds %d MB limit", maxSizeMB), nil)
	}

	mimeType := http.DetectContentType(data)
	if !iac.IsTextMIME(mimeType) {
		return apis.NewApiError(http.StatusUnsupportedMediaType,
			"binary files are not supported", nil)
	}

	return e.JSON(http.StatusOK, contentResponse{
		Path:       rel,
		Content:    string(data),
		Size:       entry.Size,
		ModifiedAt: entry.ModifiedAt,
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

// handleFileCreate creates a new file or directory under an IaC root.
//
// @Summary Create IaC file or directory
// @Description Creates a file (with optional initial content) or an empty directory. Superuser only.
// @Tags IaC
// @Security BearerAuth
// @Param body body createRequest true "path, type (file|dir), content (optional)"
// @Success 201 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 409 {object} map[string]any "already exists"
// @Router /api/ext/iac [post]
func handleFileCreate(e *core.RequestEvent) error {
	var req createRequest
	if err := e.BindBody(&req); err != nil {
		return apis.NewBadRequestError("invalid request body", err)
	}

	if req.Type == "dir" {
		if _, err := iacLocalFiles.Mkdir(req.Path); err != nil {
			if errors.Is(err, filesvc.ErrConflict) {
				return apis.NewApiError(http.StatusConflict, "path already exists", nil)
			}
			return iacPathError("invalid path", "path not found", "path is not a directory", err)
		}
		return e.JSON(http.StatusCreated, map[string]string{
			"path": req.Path,
			"type": "dir",
		})
	}

	// Default: create a file.
	if _, err := iacLocalFiles.WriteFile(req.Path, []byte(req.Content), false); err != nil {
		if errors.Is(err, filesvc.ErrConflict) {
			return apis.NewApiError(http.StatusConflict, "path already exists", nil)
		}
		return iacPathError("invalid path", "path not found", "path is a directory", err)
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

// handleFileUpdate overwrites the content of an existing IaC file.
//
// @Summary Update IaC file content
// @Description Overwrites the text content of an existing file. Superuser only.
// @Tags IaC
// @Security BearerAuth
// @Param body body updateRequest true "path, content"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/ext/iac/content [put]
func handleFileUpdate(e *core.RequestEvent) error {
	var req updateRequest
	if err := e.BindBody(&req); err != nil {
		return apis.NewBadRequestError("invalid request body", err)
	}

	if _, err := iacLocalFiles.WriteFile(req.Path, []byte(req.Content), true); err != nil {
		return iacPathError("invalid path", "file not found", "path is a directory", err)
	}
	return e.JSON(http.StatusOK, map[string]string{
		"path": req.Path,
	})
}

// ─── DELETE /api/ext/iac?path=<rel>&recursive=true ──────────────────────────

// handleFileDelete deletes a file or directory under an IaC root.
//
// @Summary Delete IaC file or directory
// @Description Deletes a file or directory. Directories require recursive=true. Root directories cannot be deleted. Superuser only.
// @Tags IaC
// @Security BearerAuth
// @Param path query string true "relative path to delete"
// @Param recursive query boolean false "set true to delete a non-empty directory"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/ext/iac [delete]
func handleFileDelete(e *core.RequestEvent) error {
	rel := e.Request.URL.Query().Get("path")
	recursive := e.Request.URL.Query().Get("recursive") == "true"

	// Block deletion of top-level root directories (apps, workflows, templates).
	if iac.RootOf(rel) == rel {
		return apis.NewBadRequestError("cannot delete a root directory", nil)
	}

	if err := iacLocalFiles.Delete(rel, recursive); err != nil {
		if errors.Is(err, filesvc.ErrDirectoryRequired) {
			return apis.NewBadRequestError("path is a directory; set recursive=true to delete", nil)
		}
		return iacPathError("invalid path", "path not found", "path is a directory; set recursive=true to delete", err)
	}

	return e.JSON(http.StatusOK, map[string]string{"path": rel})
}

// ─── POST /api/ext/iac/move ─────────────────────────────────────────────────
// Body: {"from":"apps/a/file.yml","to":"apps/b/file.yml"}

type moveRequest struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// handleFileMove moves or renames a file or directory within the IaC workspace.
//
// @Summary Move / rename IaC path
// @Description Moves a file or directory from one path to another within /appos/data. Superuser only.
// @Tags IaC
// @Security BearerAuth
// @Param body body moveRequest true "from, to (relative paths)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/ext/iac/move [post]
func handleFileMove(e *core.RequestEvent) error {
	var req moveRequest
	if err := e.BindBody(&req); err != nil {
		return apis.NewBadRequestError("invalid request body", err)
	}

	// Disallow cross-root moves (e.g. apps/ → workflows/).
	if iac.RootOf(req.From) != iac.RootOf(req.To) {
		return apis.NewBadRequestError("cross-root moves are not allowed", nil)
	}

	if _, err := iacLocalFiles.Move(req.From, req.To, false); err != nil {
		if errors.Is(err, filesvc.ErrConflict) {
			return apis.NewApiError(http.StatusConflict, "destination already exists", nil)
		}
		if errors.Is(err, filesvc.ErrNotFound) {
			return apis.NewNotFoundError("source path not found", nil)
		}
		return apis.NewBadRequestError("cannot move path", err)
	}

	return e.JSON(http.StatusOK, map[string]string{
		"from": req.From,
		"to":   req.To,
	})
}

func toIACFileEntry(entry filesvc.Entry) fileEntry {
	typ := "file"
	if entry.Kind == "directory" {
		typ = "dir"
	}
	return fileEntry{
		Name:       entry.Name,
		Type:       typ,
		Size:       entry.Size,
		ModifiedAt: entry.ModifiedAt,
	}
}

func iacPathError(invalidMsg, notFoundMsg, directoryMsg string, err error) error {
	switch {
	case errors.Is(err, filesvc.ErrInvalidPath):
		return apis.NewBadRequestError(invalidMsg, err)
	case errors.Is(err, filesvc.ErrNotFound):
		return apis.NewNotFoundError(notFoundMsg, nil)
	case errors.Is(err, filesvc.ErrDirectoryRequired):
		return apis.NewBadRequestError(directoryMsg, nil)
	case errors.Is(err, filesvc.ErrFileRequired):
		return apis.NewBadRequestError("path is a directory", nil)
	case errors.Is(err, filesvc.ErrConflict):
		return apis.NewApiError(http.StatusConflict, "path already exists", nil)
	default:
		return apis.NewBadRequestError("filesystem operation failed", err)
	}
}

// ─── POST /api/ext/iac/upload ───────────────────────────────────────────────
// multipart/form-data fields: file (file), path (string, target directory)

// handleFileUpload accepts a multipart file upload and saves it into an IaC directory.
//
// @Summary Upload file to IaC workspace
// @Description Accepts a multipart upload and saves the file to the specified directory under /appos/data. ZIP archives are extracted. Superuser only.
// @Tags IaC
// @Security BearerAuth
// @Param file formData file true "file to upload"
// @Param path formData string true "target directory (relative, e.g. apps/myapp)"
// @Success 201 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 413 {object} map[string]any
// @Failure 415 {object} map[string]any
// @Router /api/ext/iac/upload [post]
func handleFileUpload(e *core.RequestEvent) error {
	limits := iac.GetLimits(e.App)
	maxSizeMB := limits.MaxSizeMB
	maxZipSizeMB := limits.MaxZipSizeMB
	blacklist := limits.ExtensionBlacklist

	// Parse multipart; cap memory at max zip size + 1 MB overhead.
	const overhead = 1 << 20
	if err := e.Request.ParseMultipartForm((maxZipSizeMB+1)*1024*1024 + overhead); err != nil {
		return apis.NewBadRequestError("cannot parse multipart form", err)
	}

	dirRel := e.Request.FormValue("path")
	_, err := iacLocalFiles.Resolve(dirRel)
	if err != nil {
		return apis.NewBadRequestError("invalid path", err)
	}

	fh, header, err := e.Request.FormFile("file")
	if err != nil {
		return apis.NewBadRequestError("missing 'file' field", err)
	}
	defer fh.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	isZip := ext == iac.AllowedArchive

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

	if _, err := iacLocalFiles.Mkdir(dirRel); err != nil {
		return apis.NewBadRequestError("cannot create target directory", err)
	}
	destRel := filepath.ToSlash(filepath.Join(dirRel, baseName))
	if _, err := iacLocalFiles.WriteReader(destRel, fh, true, limitBytes); err != nil {
			if errors.Is(err, filesvc.ErrLimitExceeded) {
				limitMB := maxSizeMB
				if isZip {
					limitMB = maxZipSizeMB
				}
				return apis.NewApiError(http.StatusRequestEntityTooLarge,
					fmt.Sprintf("file exceeds %d MB limit", limitMB), nil)
		}
		return apis.NewBadRequestError("cannot write uploaded file", err)
	}

	return e.JSON(http.StatusCreated, map[string]string{
		"path": destRel,
	})
}

// ─── GET /api/ext/iac/download?path=<rel> ───────────────────────────────────

// handleFileDownload streams a single IaC file as an attachment download.
//
// @Summary Download IaC file
// @Description Streams the raw file content as an attachment (Content-Disposition: attachment). Superuser only.
// @Tags IaC
// @Security BearerAuth
// @Param path query string true "relative file path"
// @Success 200 {string} string "file content"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/ext/iac/download [get]
func handleFileDownload(e *core.RequestEvent) error {
	rel := e.Request.URL.Query().Get("path")

	entry, err := iacLocalFiles.Stat(rel)
	if err != nil {
		return iacPathError("invalid path", "file not found", "path is a directory; download a specific file", err)
	}
	if entry.Kind == "directory" {
		return apis.NewBadRequestError("path is a directory; download a specific file", nil)
	}
	abs, err := iacLocalFiles.Resolve(rel)
	if err != nil {
		return apis.NewBadRequestError("invalid path", err)
	}

	filename := filepath.Base(abs)
	e.Response.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename=%q`, filename))
	http.ServeFile(e.Response, e.Request, abs)

	return nil
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// handleLibraryList lists directories and files under the read-only app library.
//
// @Summary List library directory
// @Description Returns a directory listing under /appos/library (read-only). Used for custom-app template pre-fill. Superuser only.
// @Tags IaC
// @Security BearerAuth
// @Param path query string false "relative path under apps/ (e.g. myapp)"
// @Success 200 {object} listResponse
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/ext/iac/library [get]
func handleLibraryList(e *core.RequestEvent) error {
	rel := e.Request.URL.Query().Get("path")

	entries, err := libraryLocalFiles.List(rel)
	if err != nil {
		return iacPathError("invalid path", "path not found", "path is not a directory", err)
	}

	result := listResponse{
		Path:    rel,
		Entries: make([]fileEntry, 0, len(entries)),
	}
	for _, entry := range entries {
		result.Entries = append(result.Entries, toIACFileEntry(entry))
	}

	return e.JSON(http.StatusOK, result)
}

// handleLibraryRead reads the text content of a library file.
//
// @Summary Read library file content
// @Description Returns the text content of a read-only library file under /appos/library. Superuser only.
// @Tags IaC
// @Security BearerAuth
// @Param path query string true "relative file path (e.g. apps/wordpress/docker-compose.yml)"
// @Success 200 {object} contentResponse
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 415 {object} map[string]any
// @Router /api/ext/iac/library/content [get]
// Read-only file content from /appos/library/.
func handleLibraryRead(e *core.RequestEvent) error {
	rel := e.Request.URL.Query().Get("path")

	data, entry, err := libraryLocalFiles.ReadFile(rel)
	if err != nil {
		return iacPathError("invalid path", "file not found", "path is a directory", err)
	}

	limits := iac.GetLimits(e.App)
	maxSizeMB := limits.MaxSizeMB
	maxRead := int64(maxSizeMB) * 1024 * 1024

	if entry.Size > maxRead {
		return apis.NewApiError(http.StatusRequestEntityTooLarge,
			fmt.Sprintf("file exceeds %d MB limit", maxSizeMB), nil)
	}

	mimeType := http.DetectContentType(data)
	if !iac.IsTextMIME(mimeType) {
		return apis.NewApiError(http.StatusUnsupportedMediaType,
			"binary files are not supported", nil)
	}

	return e.JSON(http.StatusOK, contentResponse{
		Path:       rel,
		Content:    string(data),
		Size:       entry.Size,
		ModifiedAt: entry.ModifiedAt,
	})
}

// handleLibraryCopy copies a library app template into the IaC workspace templates directory.
//
// @Summary Copy library app to workspace
// @Description Copies /appos/library/apps/{sourceKey}/ to /appos/data/templates/apps/{destKey}/. Superuser only.
// @Tags IaC
// @Security BearerAuth
// @Param body body object true "sourceKey (library app name), destKey (optional, defaults to sourceKey)"
// @Success 200 {object} map[string]any "source, destination"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/ext/iac/library/copy [post]
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
	srcEntry, err := libraryLocalFiles.Stat(srcRel)
	if err != nil {
		return apis.NewNotFoundError("library app not found", nil)
	}
	if srcEntry.Kind != "directory" {
		return apis.NewNotFoundError("library app not found", nil)
	}

	// Destination under data/templates/apps/{destKey}.
	dstRel := "templates/apps/" + req.DestKey
	if _, err := filesvc.CopyBetween(libraryLocalFiles, srcRel, iacLocalFiles, dstRel, false); err != nil {
		if errors.Is(err, filesvc.ErrConflict) {
			return apis.NewApiError(http.StatusConflict, "destination already exists", nil)
		}
		return apis.NewBadRequestError("failed to copy library app", err)
	}

	return e.JSON(http.StatusOK, map[string]string{
		"source":      srcRel,
		"destination": dstRel,
	})
}
