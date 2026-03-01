package routes

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
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
	"maxSizeMB":              10,
	"maxPerUser":             100,
	"shareMaxMinutes":        60,
	"shareDefaultMinutes":    30,
	"maxUploadFiles":         50,
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
	f.POST("/share/{id}", handleFileShareCreate)
	f.DELETE("/share/{id}", handleFileShareRevoke)

	// Preview is registered WITHOUT the RequireAuth middleware so browsers can embed
	// the URL directly in <img>, <iframe>, <audio>, <video> tags using ?token=<token>.
	g.GET("/space/preview/{id}", handleSpacePreview)
}

// registerSpacePublicRoutes registers unauthenticated share routes on se.Router directly.
//
//	GET /api/ext/space/share/{token}           — resolve share: return file metadata
//	GET /api/ext/space/share/{token}/download  — stream file content (no auth)
func registerSpacePublicRoutes(se *core.ServeEvent) {
	pub := se.Router.Group("/api/ext/space/share")
	pub.GET("/{token}", handleFileShareResolve)
	pub.GET("/{token}/download", handleFileShareDownload)
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
		"max_size_mb":              settings.Int(quota, "maxSizeMB", 10),
		"editable_formats":         strings.Split(spaceEditableFormats, ","),
		"upload_allow_exts":        settings.StringSlice(quota, "uploadAllowExts"),
		"upload_deny_exts":         settings.StringSlice(quota, "uploadDenyExts"),
		"max_upload_files":         maxUploadFiles,
		"max_per_user":             settings.Int(quota, "maxPerUser", 100),
		"share_max_minutes":        settings.Int(quota, "shareMaxMinutes", 60),
		"share_default_minutes":    settings.Int(quota, "shareDefaultMinutes", 30),
		"reserved_folder_names":    strings.Split(spaceReservedFolderNames, ","),
		"disallowed_folder_names":  settings.StringSlice(quota, "disallowedFolderNames"),
	})
}

// handleSpacePreview streams a file for authenticated inline preview.
//
// Only MIME types in spacePreviewMimeTypeList are allowed; all others return 415.
// Security headers applied to every response:
//
//	- X-Content-Type-Options: nosniff       (prevent MIME sniffing)
//	- X-Frame-Options: SAMEORIGIN           (block embedding by third-party pages)
//	- Content-Disposition: inline           (render in browser, not download)
//	- Content-Security-Policy: sandbox      (PDF only — isolates embedded JS)
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
