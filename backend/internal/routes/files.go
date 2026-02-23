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
)

// ─── Quota constants (Phase 1: hardcoded) ──────────────────────────────────
// TODO (Story 13.2): replace each constant with a live lookup from the settings API (Epic 13).
const (
	filesMaxSizeMB = 10  // max file size in MB
	filesMaxPerUser      = 100 // max files per user
	filesShareMaxMin     = 60  // hard ceiling for share validity (minutes)
	filesShareDefaultMin = 30  // default share validity (minutes)

	// Root-level folder names reserved by the system (not creatable by users).
	// TODO (Story 13.2): make configurable via settings API.
	filesReservedFolderNames = "deploy,artifact"

	// All extensions that may be uploaded (text, code, office, pdf).
	filesAllowedUploadFormats = "txt,md,yaml,yml,json,sh,bash,zsh,fish,env,js,ts,jsx,tsx,mjs,cjs,vue,svelte," +
		"py,rb,go,rs,java,c,cpp,h,hpp,cc,cs,php,swift,kt,scala,groovy,lua,r,m,pl,pm," +
		"ex,exs,erl,hrl,clj,cljs,fs,fsx,ml,mli," +
		"css,scss,sass,less,html,htm,xml,svg,sql,graphql," +
		"toml,ini,cfg,conf,properties,gitignore,dockerignore,makefile,cmake," +
		"editorconfig,log,diff,patch,lock," +
		"pdf,doc,docx,xls,xlsx,ppt,pptx,odt,ods,odp"

	// Subset of the above that supports online (textarea) editing — text/code only.
	filesEditableFormats = "txt,md,yaml,yml,json,sh,bash,zsh,fish,env,js,ts,jsx,tsx,mjs,cjs,vue,svelte," +
		"py,rb,go,rs,java,c,cpp,h,hpp,cc,cs,php,swift,kt,scala,groovy,lua,r,m,pl,pm," +
		"ex,exs,erl,hrl,clj,cljs,fs,fsx,ml,mli," +
		"css,scss,sass,less,html,htm,xml,svg,sql,graphql," +
		"toml,ini,cfg,conf,properties,gitignore,dockerignore,makefile,cmake," +
		"editorconfig,log,diff,patch"
)

// ─── Route registration ────────────────────────────────────────────────────

// registerFileRoutes registers authenticated file ext routes under /api/ext/files.
//
//	GET    /api/ext/files/quota         — current effective quota limits (for UI pre-check)
//	POST   /api/ext/files/share/{id}    — create or refresh share token (max 60 min)
//	DELETE /api/ext/files/share/{id}    — revoke share
func registerFileRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	f := g.Group("/files")
	f.Bind(apis.RequireAuth())

	f.GET("/quota", handleFilesQuota)
	f.POST("/share/{id}", handleFileShareCreate)
	f.DELETE("/share/{id}", handleFileShareRevoke)
}

// registerFilePublicRoutes registers unauthenticated share routes on se.Router directly.
//
//	GET /api/ext/files/share/{token}           — resolve share: return file metadata
//	GET /api/ext/files/share/{token}/download  — stream file content (no auth)
func registerFilePublicRoutes(se *core.ServeEvent) {
	pub := se.Router.Group("/api/ext/files/share")
	pub.GET("/{token}", handleFileShareResolve)
	pub.GET("/{token}/download", handleFileShareDownload)
}

// ─── Handlers ──────────────────────────────────────────────────────────────

// handleFilesQuota returns the currently active quota limits.
// Phase 1: returns hardcoded constants so the frontend can use them for pre-checks.
// Phase 2 (Story 9.5): will read from the settings API (Epic 2).
func handleFilesQuota(e *core.RequestEvent) error {
	return e.JSON(http.StatusOK, map[string]any{
		"max_size_mb":             filesMaxSizeMB,
		"allowed_upload_formats": strings.Split(filesAllowedUploadFormats, ","),
		"editable_formats":       strings.Split(filesEditableFormats, ","),
		"max_per_user":           filesMaxPerUser,
		"share_max_minutes":      filesShareMaxMin,
		"share_default_minutes":  filesShareDefaultMin,
		"reserved_folder_names": strings.Split(filesReservedFolderNames, ","),
	})
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

	// Parse duration from body; fall back to default.
	var body struct {
		Minutes int `json:"minutes"`
	}
	_ = e.BindBody(&body) // ignore parse errors; zero value is fine
	if body.Minutes <= 0 {
		body.Minutes = filesShareDefaultMin
	}
	// Enforce hard ceiling.
	if body.Minutes > filesShareMaxMin {
		return e.BadRequestError(
			fmt.Sprintf("share duration cannot exceed %d minutes", filesShareMaxMin), nil,
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
		"share_url":   "/api/ext/files/share/" + token + "/download",
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
		"download_url": "/api/ext/files/share/" + token + "/download",
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
