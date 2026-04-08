package routes

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/websoft9/appos/backend/domain/space"
	"github.com/websoft9/appos/backend/infra/safefetch"
)

// ─── Route registration ────────────────────────────────────────────────────

// registerSpaceRoutes registers authenticated space routes under /api/space.
//
// GET    /api/space/quota         — current effective quota limits (for UI pre-check)
// POST   /api/space/fetch         — fetch remote URL into user space
// POST   /api/space/share/{id}    — create or refresh share token
// DELETE /api/space/share/{id}    — revoke share
func registerSpaceRoutes(se *core.ServeEvent) {
	f := se.Router.Group("/api/space")
	f.Bind(apis.RequireAuth())

	f.GET("/quota", handleSpaceQuota)
	f.POST("/fetch", handleSpaceFetch)
	f.POST("/share/{id}", handleFileShareCreate)
	f.DELETE("/share/{id}", handleFileShareRevoke)
}

// registerSpacePublicRoutes registers unauthenticated space routes under /api/space.
//
// GET /api/space/preview/{id}           — inline preview via Authorization header or ?token=
// GET /api/space/share/{token}          — resolve share: return file metadata
// GET /api/space/share/{token}/download — stream file content (no auth)
func registerSpacePublicRoutes(se *core.ServeEvent) {
	pub := se.Router.Group("/api/space")
	pub.GET("/preview/{id}", handleSpacePreview)
	pub.GET("/share/{token}", handleFileShareResolve)
	pub.GET("/share/{token}/download", handleFileShareDownload)
}

// ─── Handlers ──────────────────────────────────────────────────────────────

// handleSpaceQuota returns the currently active quota limits.
//
// @Summary Get space quota limits
// @Description Returns effective upload/share quota limits for the authenticated user. Auth required.
// @Tags Space
// @Security BearerAuth
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/space/quota [get]
func handleSpaceQuota(e *core.RequestEvent) error {
	quota := space.GetQuota(e.App)
	return e.JSON(http.StatusOK, map[string]any{
		"max_size_mb":             quota.MaxSizeMB,
		"editable_formats":        strings.Split(space.EditableFormats, ","),
		"upload_allow_exts":       quota.UploadAllowExts,
		"upload_deny_exts":        quota.UploadDenyExts,
		"max_upload_files":        quota.MaxUploadFiles,
		"max_per_user":            quota.MaxPerUser,
		"share_max_minutes":       quota.ShareMaxMinutes,
		"share_default_minutes":   quota.ShareDefaultMinutes,
		"reserved_folder_names":   strings.Split(space.ReservedFolderNames, ","),
		"disallowed_folder_names": quota.DisallowedFolderNames,
	})
}

// handleSpacePreview streams a file for authenticated inline preview.
//
// Supports auth via Authorization header OR ?token= query param (for browser embed).
// Only MIME types in space.PreviewMimeTypes are allowed; others return 415.
//
// @Summary Preview file inline
// @Description Streams a file for inline browser preview. Public route (token validated internally).
// @Tags Space
// @Param id path string true "user_files record ID"
// @Param token query string false "auth token (for browser embed contexts)"
// @Success 200 {string} string "file content"
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 415 {object} map[string]any
// @Router /api/space/preview/{id} [get]
func handleSpacePreview(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")

	auth := e.Auth
	if auth == nil {
		if tok := e.Request.URL.Query().Get("token"); tok != "" {
			rec, err := e.App.FindAuthRecordByToken(tok, core.TokenTypeAuth)
			if err == nil {
				auth = rec
			}
		}
	}
	if auth == nil {
		return e.ForbiddenError("Authentication required", nil)
	}

	record, err := e.App.FindRecordById(space.Collection, id)
	if err != nil {
		return e.NotFoundError("File not found", err)
	}

	uf := space.From(record)

	if !uf.IsOwnedBy(auth) {
		return e.ForbiddenError("Access denied", nil)
	}
	if uf.IsFolder() {
		return e.BadRequestError("Folders cannot be previewed", nil)
	}
	if !uf.IsPreviewable() {
		return e.JSON(http.StatusUnsupportedMediaType,
			fileError("preview not supported for this file type"))
	}

	storedFilename := uf.StoredFilename()
	if storedFilename == "" {
		return e.NotFoundError("File content not found", nil)
	}

	fs, err := e.App.NewFilesystem()
	if err != nil {
		return e.JSON(http.StatusInternalServerError, fileError("storage unavailable"))
	}
	defer fs.Close()

	storageKey := path.Join(record.Collection().Id, record.Id, storedFilename)
	f, err := fs.GetFile(storageKey)
	if err != nil {
		return e.NotFoundError("File not found in storage", err)
	}
	defer f.Close()

	mimeType := uf.EffectiveMimeType()
	h := e.Response.Header()
	h.Set("Content-Type", mimeType)
	h.Set("Content-Disposition", "inline")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "SAMEORIGIN")
	if mimeType == "application/pdf" {
		h.Set("Content-Security-Policy", "sandbox")
	}

	e.Response.WriteHeader(http.StatusOK)
	_, _ = io.Copy(e.Response, f)
	return nil
}

// handleFileShareCreate creates or refreshes a time-limited share token for a file.
//
// @Summary Create file share token
// @Description Creates or refreshes a share link (max shareMaxMinutes). Auth required.
// @Tags Space
// @Security BearerAuth
// @Param id path string true "user_files record ID"
// @Param body body object false "minutes (optional)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/space/share/{id} [post]
func handleFileShareCreate(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")

	record, err := e.App.FindRecordById(space.Collection, id)
	if err != nil {
		return e.NotFoundError("File not found", err)
	}

	if !space.From(record).IsOwnedBy(e.Auth) {
		return e.ForbiddenError("Access denied", nil)
	}

	quota := space.GetQuota(e.App)

	var body struct {
		Minutes int `json:"minutes"`
	}
	_ = e.BindBody(&body)

	sh, err := space.NewShareToken(body.Minutes, quota.ShareMaxMinutes, quota.ShareDefaultMinutes)
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}

	record.Set("share_token", sh.Token)
	record.Set("share_expires_at", sh.ExpiresAt.Format(time.RFC3339))
	if err := e.App.Save(record); err != nil {
		return e.JSON(http.StatusInternalServerError, fileError("failed to save share token"))
	}

	return e.JSON(http.StatusOK, map[string]any{
		"share_token": sh.Token,
		"share_url":   "/api/space/share/" + sh.Token + "/download",
		"expires_at":  sh.ExpiresAt.Format(time.RFC3339),
	})
}

// handleFileShareRevoke clears the share token and expiry on a user_files record.
//
// @Summary Revoke file share token
// @Description Deletes the share token, immediately invalidating public share links. Auth required.
// @Tags Space
// @Security BearerAuth
// @Param id path string true "user_files record ID"
// @Success 204
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/space/share/{id} [delete]
func handleFileShareRevoke(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")

	record, err := e.App.FindRecordById(space.Collection, id)
	if err != nil {
		return e.NotFoundError("File not found", err)
	}

	if !space.From(record).IsOwnedBy(e.Auth) {
		return e.ForbiddenError("Access denied", nil)
	}

	record.Set("share_token", "")
	record.Set("share_expires_at", "")
	if err := e.App.Save(record); err != nil {
		return e.JSON(http.StatusInternalServerError, fileError("failed to revoke share"))
	}

	return e.NoContent(http.StatusNoContent)
}

// handleFileShareResolve resolves a share token and returns file metadata.
//
// @Summary Resolve share token
// @Description Returns file metadata for a valid share token. Public.
// @Tags Space
// @Param token path string true "share token"
// @Success 200 {object} map[string]any
// @Failure 403 {object} map[string]any "share expired or revoked"
// @Failure 404 {object} map[string]any
// @Router /api/space/share/{token} [get]
func handleFileShareResolve(e *core.RequestEvent) error {
	token := e.Request.PathValue("token")

	record, err := findByShareToken(e, token)
	if err != nil {
		return e.NotFoundError("Share link not found", nil)
	}

	uf := space.From(record)
	if active, reason := uf.ShareIsActive(); !active {
		return e.JSON(http.StatusForbidden, fileError(reason))
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":           uf.ID(),
		"name":         uf.Name(),
		"mime_type":    uf.EffectiveMimeType(),
		"download_url": "/api/space/share/" + token + "/download",
		"expires_at":   record.GetString("share_expires_at"),
	})
}

// handleFileShareDownload streams the file content for a valid share token.
//
// @Summary Download shared file
// @Description Streams the file content for a valid public share token. No authentication required.
// @Tags Space
// @Param token path string true "share token"
// @Success 200 {string} string "file content"
// @Failure 403 {object} map[string]any "share expired or revoked"
// @Failure 404 {object} map[string]any
// @Router /api/space/share/{token}/download [get]
func handleFileShareDownload(e *core.RequestEvent) error {
	token := e.Request.PathValue("token")

	record, err := findByShareToken(e, token)
	if err != nil {
		return e.NotFoundError("Share link not found", nil)
	}

	uf := space.From(record)
	if active, reason := uf.ShareIsActive(); !active {
		return e.JSON(http.StatusForbidden, fileError(reason))
	}

	storedFilename := uf.StoredFilename()
	if storedFilename == "" {
		return e.NotFoundError("File content not found", nil)
	}

	fs, err := e.App.NewFilesystem()
	if err != nil {
		return e.JSON(http.StatusInternalServerError, fileError("storage unavailable"))
	}
	defer fs.Close()

	storageKey := path.Join(record.Collection().Id, record.Id, storedFilename)
	f, err := fs.GetFile(storageKey)
	if err != nil {
		return e.NotFoundError("File not found in storage", err)
	}
	defer f.Close()

	mimeType := uf.EffectiveMimeType()
	e.Response.Header().Set("Content-Type", mimeType)
	e.Response.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename=%q`, uf.EffectiveDisplayName()))
	e.Response.WriteHeader(http.StatusOK)
	_, _ = io.Copy(e.Response, f)
	return nil
}

// handleSpaceFetch fetches a remote resource and saves it to the user's space.
//
// @Summary Fetch remote file into space
// @Description Downloads a remote URL and stores the result as a user_files record. Auth required.
// @Tags Space
// @Security BearerAuth
// @Param body body object true "url, optional name and parent folder ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/space/fetch [post]
func handleSpaceFetch(e *core.RequestEvent) error {
	authRecord := e.Auth

	var body struct {
		URL    string `json:"url"`
		Name   string `json:"name"`
		Parent string `json:"parent"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid request body", err)
	}
	body.URL = strings.TrimSpace(body.URL)
	if body.URL == "" {
		return e.BadRequestError("url is required", nil)
	}

	parsed, err := safefetch.ValidateURL(body.URL)
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}

	quota := space.GetQuota(e.App)
	maxBytes := int64(quota.MaxSizeMB) * 1024 * 1024

	// Validate parent folder if provided.
	body.Parent = strings.TrimSpace(body.Parent)
	if body.Parent != "" {
		parent, err := e.App.FindRecordById(space.Collection, body.Parent)
		if err != nil {
			return e.BadRequestError("parent folder not found", nil)
		}
		parentFile := space.From(parent)
		if !parentFile.IsOwnedByID(authRecord.Id) {
			return e.ForbiddenError("access denied to parent folder", nil)
		}
		if !parentFile.IsFolder() {
			return e.BadRequestError("parent must be a folder", nil)
		}
		if parentFile.IsDeleted() {
			return e.BadRequestError("cannot save into trash folder", nil)
		}
	}

	// Enforce per-user item limit.
	if quota.MaxPerUser > 0 {
		existing, err := e.App.FindAllRecords(space.Collection, dbx.HashExp{"owner": authRecord.Id})
		if err == nil {
			if itemErr := space.ValidateItemCount(len(existing), quota.MaxPerUser); itemErr != nil {
				return e.BadRequestError(itemErr.Error(), nil)
			}
		}
	}

	// Derive target filename from the URL path if not provided.
	name := strings.TrimSpace(body.Name)
	if name == "" {
		parts := strings.Split(parsed.Path, "/")
		for i := len(parts) - 1; i >= 0; i-- {
			if p := strings.TrimSpace(parts[i]); p != "" {
				name = p
				break
			}
		}
		if name == "" {
			name = "download"
		}
	}

	// Validate extension compliance.
	ext := ""
	if idx := strings.LastIndex(name, "."); idx >= 0 {
		ext = space.NormalizeExt(name[idx+1:])
	}
	if ext == "" {
		return e.BadRequestError("file has no extension; add a filename with an extension", nil)
	}
	if extErr := space.ValidateExt(quota, ext); extErr != nil {
		return e.BadRequestError(extErr.Error(), nil)
	}

	client := safefetch.NewClient()

	// Optional early rejection via HEAD.
	headCtx, headCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer headCancel()
	if headReq, headErr := http.NewRequestWithContext(headCtx, http.MethodHead, body.URL, nil); headErr == nil {
		if headResp, err := client.Do(headReq); err == nil {
			headResp.Body.Close()
			if headResp.ContentLength > maxBytes {
				return e.BadRequestError(
					fmt.Sprintf("remote file is too large (limit %d MB)", quota.MaxSizeMB), nil)
			}
		}
	}

	// Download with a hard size cap and timeout.
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, body.URL, nil)
	if err != nil {
		return e.BadRequestError("failed to build request: "+err.Error(), nil)
	}
	getResp, err := client.Do(req)
	if err != nil {
		return e.BadRequestError("failed to fetch URL: "+err.Error(), nil)
	}
	defer getResp.Body.Close()

	if getResp.StatusCode < 200 || getResp.StatusCode > 299 {
		return e.BadRequestError(
			fmt.Sprintf("remote server returned HTTP %d", getResp.StatusCode), nil)
	}

	data, err := io.ReadAll(io.LimitReader(getResp.Body, maxBytes+1))
	if err != nil {
		return e.BadRequestError("failed to read remote content: "+err.Error(), nil)
	}
	if int64(len(data)) > maxBytes {
		return e.BadRequestError(
			fmt.Sprintf("remote file exceeds size limit (%d MB)", quota.MaxSizeMB), nil)
	}

	// Detect MIME type; prefer server's Content-Type header.
	mimeType := http.DetectContentType(data)
	if ct := getResp.Header.Get("Content-Type"); ct != "" {
		if idx := strings.Index(ct, ";"); idx >= 0 {
			ct = ct[:idx]
		}
		ct = strings.TrimSpace(ct)
		if ct != "" && ct != "application/octet-stream" {
			mimeType = ct
		}
	}

	pbFile, err := filesystem.NewFileFromBytes(data, name)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, fileError("failed to create file object"))
	}

	col, err := e.App.FindCollectionByNameOrId(space.Collection)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, fileError("user_files collection not found"))
	}

	newRecord := core.NewRecord(col)
	newRecord.Set("owner", authRecord.Id)
	newRecord.Set("name", name)
	newRecord.Set("mime_type", mimeType)
	newRecord.Set("size", len(data))
	newRecord.Set("parent", body.Parent)
	newRecord.Set("is_folder", false)
	newRecord.Set("content", pbFile)

	if err := e.App.Save(newRecord); err != nil {
		return e.JSON(http.StatusInternalServerError, fileError("failed to save file: "+err.Error()))
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":        newRecord.Id,
		"name":      newRecord.GetString("name"),
		"size":      newRecord.GetInt("size"),
		"mime_type": newRecord.GetString("mime_type"),
	})
}

// ─── Helpers ───────────────────────────────────────────────────────────────

func findByShareToken(e *core.RequestEvent, token string) (*core.Record, error) {
	return e.App.FindFirstRecordByData(space.Collection, "share_token", token)
}

func fileError(msg string) map[string]any {
	return map[string]any{"message": msg}
}
