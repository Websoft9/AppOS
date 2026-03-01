package routes

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/internal/settings"
)

// ─── Quota defaults (Story 13.2: values now stored in app_settings DB) ───────
//
// defaultSpaceQuota is the code-level safety net used when the DB row is
// missing or unavailable.  settings.GetGroup always returns a non-nil map, so
// callers using  quota, _ := settings.GetGroup(...)  are always safe.
//
// NOTE: These values must stay in sync with:
//   - routes/settings.go  fallbackForKey("space/quota")
//   - migrations/1741200001_seed_app_settings.go  (seed defaults)
var defaultSpaceQuota = map[string]any{
	"maxSizeMB":             10,
	"maxPerUser":            100,
	"shareMaxMinutes":       60,
	"shareDefaultMinutes":   30,
	"maxUploadFiles":        50,
	"disallowedFolderNames": []string{},
}

const (
	// Root-level folder names reserved by the system (not creatable by users).
	spaceReservedFolderNames = "deploy,artifact"

	// MIME types allowed for authenticated inline preview.
	// SVG is included — the frontend renders it via <img> which blocks JS execution.
	spacePreviewMimeTypeList = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml," +
		"image/bmp,image/x-icon,application/pdf," +
		"audio/mpeg,audio/wav,audio/ogg,audio/aac,audio/flac,audio/webm," +
		"video/mp4,video/webm,video/ogg"

	// All extensions that may be uploaded (text, code, office, pdf).
	spaceAllowedUploadFormats = "txt,md,yaml,yml,json,sh,bash,zsh,fish,env,js,ts,jsx,tsx,mjs,cjs,vue,svelte," +
		"py,rb,go,rs,java,c,cpp,h,hpp,cc,cs,php,swift,kt,scala,groovy,lua,r,m,pl,pm," +
		"ex,exs,erl,hrl,clj,cljs,fs,fsx,ml,mli," +
		"css,scss,sass,less,html,htm,xml,svg,sql,graphql," +
		"toml,ini,cfg,conf,properties,gitignore,dockerignore,makefile,cmake," +
		"editorconfig,log,diff,patch,lock," +
		"pdf,doc,docx,xls,xlsx,ppt,pptx,odt,ods,odp"

	// Subset of the above that supports online (textarea) editing — text/code only.
	spaceEditableFormats = "txt,md,yaml,yml,json,sh,bash,zsh,fish,env,js,ts,jsx,tsx,mjs,cjs,vue,svelte," +
		"py,rb,go,rs,java,c,cpp,h,hpp,cc,cs,php,swift,kt,scala,groovy,lua,r,m,pl,pm," +
		"ex,exs,erl,hrl,clj,cljs,fs,fsx,ml,mli," +
		"css,scss,sass,less,html,htm,xml,svg,sql,graphql," +
		"toml,ini,cfg,conf,properties,gitignore,dockerignore,makefile,cmake," +
		"editorconfig,log,diff,patch"
)

// ─── Route registration ────────────────────────────────────────────────────

// registerSpaceRoutes registers authenticated space ext routes under /api/ext/space.
//
//	GET    /api/ext/space/quota         — current effective quota limits (for UI pre-check)
//	POST   /api/ext/space/share/{id}    — create or refresh share token (max 60 min)
//	DELETE /api/ext/space/share/{id}    — revoke share
func registerSpaceRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	f := g.Group("/space")
	f.Bind(apis.RequireAuth())

	f.GET("/quota", handleSpaceQuota)
	f.POST("/fetch", handleSpaceFetch)
	f.POST("/share/{id}", handleFileShareCreate)
	f.DELETE("/share/{id}", handleFileShareRevoke)
}

// registerSpacePublicRoutes registers unauthenticated space routes on se.Router.
//
//	GET /api/ext/space/preview/{id}          — authenticated preview via ?token= (for browser embed)
//	GET /api/ext/space/share/{token}          — resolve share: return file metadata
//	GET /api/ext/space/share/{token}/download — stream file content (no auth)
func registerSpacePublicRoutes(se *core.ServeEvent) {
	pub := se.Router.Group("/api/ext/space")
	pub.GET("/preview/{id}", handleSpacePreview)
	pub.GET("/share/{token}", handleFileShareResolve)
	pub.GET("/share/{token}/download", handleFileShareDownload)
}

// ─── Handlers ──────────────────────────────────────────────────────────────

// handleSpaceQuota returns the currently active quota limits read from app_settings.
func handleSpaceQuota(e *core.RequestEvent) error {
	quota, _ := settings.GetGroup(e.App, "space", "quota", defaultSpaceQuota)
	maxUploadFiles := settings.Int(quota, "maxUploadFiles", 50)
	if maxUploadFiles < 1 {
		maxUploadFiles = 50
	}
	if maxUploadFiles > 200 {
		maxUploadFiles = 200
	}
	return e.JSON(http.StatusOK, map[string]any{
		"max_size_mb":             settings.Int(quota, "maxSizeMB", 10),
		"editable_formats":        strings.Split(spaceEditableFormats, ","),
		"upload_allow_exts":       settings.StringSlice(quota, "uploadAllowExts"),
		"upload_deny_exts":        settings.StringSlice(quota, "uploadDenyExts"),
		"max_upload_files":        maxUploadFiles,
		"max_per_user":            settings.Int(quota, "maxPerUser", 100),
		"share_max_minutes":       settings.Int(quota, "shareMaxMinutes", 60),
		"share_default_minutes":   settings.Int(quota, "shareDefaultMinutes", 30),
		"reserved_folder_names":   strings.Split(spaceReservedFolderNames, ","),
		"disallowed_folder_names": settings.StringSlice(quota, "disallowedFolderNames"),
	})
}

// handleSpacePreview streams a file for authenticated inline preview.
//
// Only MIME types in spacePreviewMimeTypeList are allowed; all others return 415.
// Security headers applied to every response:
//
//   - X-Content-Type-Options: nosniff       (prevent MIME sniffing)
//   - X-Frame-Options: SAMEORIGIN           (block embedding by third-party pages)
//   - Content-Disposition: inline           (render in browser, not download)
//   - Content-Security-Policy: sandbox      (PDF only — isolates embedded JS)
//
// SVG is served as image/svg+xml; the frontend MUST render via <img>, which
// silently blocks all script execution — no extra server-side handling needed.
func handleSpacePreview(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")

	// Resolve auth from Authorization header OR ?token= query param.
	// The query param path exists so browsers can embed the URL directly in
	// <img src>, <audio src>, <video src>, <iframe src> tags which cannot
	// set custom request headers.
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

	record, err := e.App.FindRecordById("user_files", id)
	if err != nil {
		return e.NotFoundError("File not found", err)
	}

	// Ownership check.
	if record.GetString("owner") != auth.Id {
		return e.ForbiddenError("Access denied", nil)
	}

	// Deny folders.
	if record.GetBool("is_folder") {
		return e.BadRequestError("Folders cannot be previewed", nil)
	}

	mimeType := record.GetString("mime_type")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	// Whitelist check.
	allowed := false
	for _, m := range strings.Split(spacePreviewMimeTypeList, ",") {
		if strings.TrimSpace(m) == mimeType {
			allowed = true
			break
		}
	}
	if !allowed {
		return e.JSON(http.StatusUnsupportedMediaType,
			fileError("preview not supported for this file type"))
	}

	storedFilename := record.GetString("content")
	if storedFilename == "" {
		return e.NotFoundError("File content not found", nil)
	}

	fs, err := e.App.NewFilesystem()
	if err != nil {
		return e.JSON(http.StatusInternalServerError, fileError("storage unavailable"))
	}
	defer fs.Close()

	col := record.Collection()
	storageKey := path.Join(col.Id, record.Id, storedFilename)

	f, err := fs.GetFile(storageKey)
	if err != nil {
		return e.NotFoundError("File not found in storage", err)
	}
	defer f.Close()

	h := e.Response.Header()
	h.Set("Content-Type", mimeType)
	h.Set("Content-Disposition", "inline")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("X-Frame-Options", "SAMEORIGIN")

	// For PDF: add CSP sandbox to isolate embedded JavaScript.
	if mimeType == "application/pdf" {
		h.Set("Content-Security-Policy", "sandbox")
	}

	e.Response.WriteHeader(http.StatusOK)
	_, _ = io.Copy(e.Response, f)
	return nil
}

// handleFileShareCreate creates or refreshes a share token on a user_files record.
//
// Request body (JSON):
//
//	{ "minutes": 30 }   — optional; defaults to filesShareDefaultMin; max filesShareMaxMin
//
// Response:
//
//	{ "share_token": "...", "share_url": "/files/share/...", "expires_at": "..." }
func handleFileShareCreate(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")

	record, err := e.App.FindRecordById("user_files", id)
	if err != nil {
		return e.NotFoundError("File not found", err)
	}

	// Verify ownership.
	authRecord := e.Auth
	if authRecord == nil || record.GetString("owner") != authRecord.Id {
		return e.ForbiddenError("Access denied", nil)
	}

	// Load quota from settings DB (fallback to code defaults if unavailable).
	quota, _ := settings.GetGroup(e.App, "space", "quota", defaultSpaceQuota)
	shareMaxMin := settings.Int(quota, "shareMaxMinutes", 60)
	shareDefaultMin := settings.Int(quota, "shareDefaultMinutes", 30)

	// Parse duration from body; fall back to default.
	var body struct {
		Minutes int `json:"minutes"`
	}
	_ = e.BindBody(&body) // ignore parse errors; zero value is fine
	if body.Minutes <= 0 {
		body.Minutes = shareDefaultMin
	}
	// Enforce hard ceiling.
	if body.Minutes > shareMaxMin {
		return e.BadRequestError(
			fmt.Sprintf("share duration cannot exceed %d minutes", shareMaxMin), nil,
		)
	}

	// Generate a random 32-byte hex token.
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return e.JSON(http.StatusInternalServerError, fileError("failed to generate share token"))
	}
	token := hex.EncodeToString(tokenBytes)
	expiresAt := time.Now().UTC().Add(time.Duration(body.Minutes) * time.Minute)

	record.Set("share_token", token)
	record.Set("share_expires_at", expiresAt.Format(time.RFC3339))
	if err := e.App.Save(record); err != nil {
		return e.JSON(http.StatusInternalServerError, fileError("failed to save share token"))
	}

	return e.JSON(http.StatusOK, map[string]any{
		"share_token": token,
		"share_url":   "/api/ext/space/share/" + token + "/download",
		"expires_at":  expiresAt.Format(time.RFC3339),
	})
}

// handleFileShareRevoke clears the share token and expiry on a user_files record.
func handleFileShareRevoke(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")

	record, err := e.App.FindRecordById("user_files", id)
	if err != nil {
		return e.NotFoundError("File not found", err)
	}

	// Verify ownership.
	authRecord := e.Auth
	if authRecord == nil || record.GetString("owner") != authRecord.Id {
		return e.ForbiddenError("Access denied", nil)
	}

	record.Set("share_token", "")
	record.Set("share_expires_at", "")
	if err := e.App.Save(record); err != nil {
		return e.JSON(http.StatusInternalServerError, fileError("failed to revoke share"))
	}

	return e.NoContent(http.StatusNoContent)
}

// handleFileShareResolve is a public (no auth) endpoint that validates a share token
// and returns file metadata. The client uses this to display the share page.
//
// Returns 200 with metadata on success, 404 if token unknown, 403 if expired.
func handleFileShareResolve(e *core.RequestEvent) error {
	token := e.Request.PathValue("token")

	record, err := findByShareToken(e, token)
	if err != nil {
		return e.NotFoundError("Share link not found", nil)
	}

	if expired, reason := isShareExpired(record); expired {
		return e.JSON(http.StatusForbidden, fileError(reason))
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":           record.Id,
		"name":         record.GetString("name"),
		"mime_type":    record.GetString("mime_type"),
		"download_url": "/api/ext/space/share/" + token + "/download",
		"expires_at":   record.GetString("share_expires_at"),
	})
}

// handleFileShareDownload is a public (no auth) endpoint that streams the file
// content directly from PocketBase storage after validating the share token.
func handleFileShareDownload(e *core.RequestEvent) error {
	token := e.Request.PathValue("token")

	record, err := findByShareToken(e, token)
	if err != nil {
		return e.NotFoundError("Share link not found", nil)
	}

	if expired, reason := isShareExpired(record); expired {
		return e.JSON(http.StatusForbidden, fileError(reason))
	}

	// PocketBase stores the normalized filename in the file field.
	storedFilename := record.GetString("content")
	if storedFilename == "" {
		return e.NotFoundError("File content not found", nil)
	}

	// Open PocketBase filesystem and stream the file.
	fs, err := e.App.NewFilesystem()
	if err != nil {
		return e.JSON(http.StatusInternalServerError, fileError("storage unavailable"))
	}
	defer fs.Close()

	// Storage key format: {collectionId}/{recordId}/{filename}
	col := record.Collection()
	storageKey := path.Join(col.Id, record.Id, storedFilename)

	f, err := fs.GetFile(storageKey)
	if err != nil {
		return e.NotFoundError("File not found in storage", err)
	}
	defer f.Close()

	// Use the user-facing name for the download prompt.
	displayName := record.GetString("name")
	if displayName == "" {
		displayName = storedFilename
	}
	mimeType := record.GetString("mime_type")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	e.Response.Header().Set("Content-Type", mimeType)
	e.Response.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename=%q`, displayName))
	e.Response.WriteHeader(http.StatusOK)
	_, _ = io.Copy(e.Response, f)
	return nil
}

// ─── Helpers ───────────────────────────────────────────────────────────────

func findByShareToken(e *core.RequestEvent, token string) (*core.Record, error) {
	return e.App.FindFirstRecordByData("user_files", "share_token", token)
}

func isShareExpired(record *core.Record) (bool, string) {
	raw := record.GetString("share_token")
	if raw == "" {
		return true, "share link has been revoked"
	}
	expiresRaw := record.GetString("share_expires_at")
	if expiresRaw == "" {
		return true, "share link has no expiry set"
	}
	expiresAt, err := time.Parse(time.RFC3339, expiresRaw)
	if err != nil {
		return true, "invalid share expiry"
	}
	if time.Now().UTC().After(expiresAt) {
		return true, "share link has expired"
	}
	return false, ""
}

func fileError(msg string) map[string]any {
	return map[string]any{"message": msg}
}

// handleSpaceFetch downloads a remote URL and saves it directly to the user's space.
//
// POST /api/ext/space/fetch
// Body: { "url": "https://...", "name": "optional.ext", "parent": "optionalFolderId" }
//
// Compliance checks (same policy as upload):
//   - URL must be http or https
//   - Extension must pass allowlist / denylist
//   - Downloaded size must not exceed max_size_mb quota
func handleSpaceFetch(e *core.RequestEvent) error {
	authRecord := e.Auth
	if authRecord == nil {
		return e.ForbiddenError("authentication required", nil)
	}

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

	// Validate URL scheme (http/https only, no SSRF via file:// etc.)
	parsed, err := url.ParseRequestURI(body.URL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return e.BadRequestError("only http and https URLs are supported", nil)
	}

	// Reject private/loopback addresses to prevent SSRF.
	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || strings.HasPrefix(host, "127.") ||
		strings.HasPrefix(host, "10.") || strings.HasPrefix(host, "192.168.") ||
		strings.HasPrefix(host, "172.") || host == "::1" || host == "0.0.0.0" {
		return e.BadRequestError("private/loopback URLs are not allowed", nil)
	}

	// Read quota settings.
	quota, _ := settings.GetGroup(e.App, "space", "quota", defaultSpaceQuota)
	maxSizeMB := settings.Int(quota, "maxSizeMB", 10)
	maxBytes := int64(maxSizeMB) * 1024 * 1024
	maxPerUser := settings.Int(quota, "maxPerUser", 100)
	allowExts := settings.StringSlice(quota, "uploadAllowExts")
	denyExts := settings.StringSlice(quota, "uploadDenyExts")

	// Validate parent folder if provided.
	body.Parent = strings.TrimSpace(body.Parent)
	if body.Parent != "" {
		parent, err := e.App.FindRecordById("user_files", body.Parent)
		if err != nil {
			return e.BadRequestError("parent folder not found", nil)
		}
		if parent.GetString("owner") != authRecord.Id {
			return e.ForbiddenError("access denied to parent folder", nil)
		}
		if !parent.GetBool("is_folder") {
			return e.BadRequestError("parent must be a folder", nil)
		}
		if parent.GetBool("is_deleted") {
			return e.BadRequestError("cannot save into trash folder", nil)
		}
	}

	// Enforce per-user item limit (same behavior as create hooks).
	if maxPerUser > 0 {
		existing, err := e.App.FindAllRecords("user_files", dbx.HashExp{"owner": authRecord.Id})
		if err == nil && len(existing) >= maxPerUser {
			return e.BadRequestError(
				fmt.Sprintf("file limit reached (%d); delete some files before uploading new ones", maxPerUser), nil)
		}
	}
	// Derive target filename.
	name := strings.TrimSpace(body.Name)
	if name == "" {
		// Extract last non-empty path segment, strip query string.
		urlPath := parsed.Path
		parts := strings.Split(urlPath, "/")
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
		ext = normalizeSpaceExtToken(name[idx+1:])
	}
	if ext == "" {
		return e.BadRequestError("file has no extension; add a filename with an extension", nil)
	}
	if len(allowExts) > 0 {
		allowed := false
		for _, a := range allowExts {
			if normalizeSpaceExtToken(a) == ext {
				allowed = true
				break
			}
		}
		if !allowed {
			return e.BadRequestError(fmt.Sprintf("extension .%s is not in the upload allowlist", ext), nil)
		}
	} else if len(denyExts) > 0 {
		for _, d := range denyExts {
			if normalizeSpaceExtToken(d) == ext {
				return e.BadRequestError(fmt.Sprintf("extension .%s is blocked by the upload denylist", ext), nil)
			}
		}
	}

	// Optional early rejection: HEAD request to check Content-Length.
	headClient := &http.Client{Timeout: 15 * time.Second}
	if headResp, err := headClient.Head(body.URL); err == nil {
		headResp.Body.Close()
		if headResp.ContentLength > maxBytes {
			return e.BadRequestError(
				fmt.Sprintf("remote file is too large (limit %d MB)", maxSizeMB), nil)
		}
	}

	// Download with a hard size cap and timeout.
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, body.URL, nil)
	if err != nil {
		return e.BadRequestError("failed to build request: "+err.Error(), nil)
	}
	getResp, err := (&http.Client{}).Do(req)
	if err != nil {
		return e.BadRequestError("failed to fetch URL: "+err.Error(), nil)
	}
	defer getResp.Body.Close()

	if getResp.StatusCode < 200 || getResp.StatusCode > 299 {
		return e.BadRequestError(
			fmt.Sprintf("remote server returned HTTP %d", getResp.StatusCode), nil)
	}

	// Read up to maxBytes+1 so we can detect over-size.
	data, err := io.ReadAll(io.LimitReader(getResp.Body, maxBytes+1))
	if err != nil {
		return e.BadRequestError("failed to read remote content: "+err.Error(), nil)
	}
	if int64(len(data)) > maxBytes {
		return e.BadRequestError(
			fmt.Sprintf("remote file exceeds size limit (%d MB)", maxSizeMB), nil)
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

	// Create PocketBase file object and save record.
	pbFile, err := filesystem.NewFileFromBytes(data, name)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, fileError("failed to create file object"))
	}

	col, err := e.App.FindCollectionByNameOrId("user_files")
	if err != nil {
		return e.JSON(http.StatusInternalServerError, fileError("user_files collection not found"))
	}

	record := core.NewRecord(col)
	record.Set("owner", authRecord.Id)
	record.Set("name", name)
	record.Set("mime_type", mimeType)
	record.Set("size", len(data))
	record.Set("parent", body.Parent)
	record.Set("is_folder", false)
	record.Set("content", pbFile)

	if err := e.App.Save(record); err != nil {
		return e.JSON(http.StatusInternalServerError, fileError("failed to save file: "+err.Error()))
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":        record.Id,
		"name":      record.GetString("name"),
		"size":      record.GetInt("size"),
		"mime_type": record.GetString("mime_type"),
	})
}

func normalizeSpaceExtToken(v string) string {
	v = strings.ToLower(strings.TrimSpace(v))
	v = strings.TrimPrefix(v, ".")
	if v == "python" {
		return "py"
	}
	return v
}
