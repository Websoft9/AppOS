// Package space implements the Space domain — the user's personal file workspace.
//
// A UserFile is an owner-first entity: each file or folder is owned by exactly
// one authenticated user. Core capabilities are upload, preview, share, and
// remote-fetch.
//
// Domain boundary: this package must not import backend/infra or backend/platform.
// PocketBase core is treated as a shared foundation layer.
package space

import (
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	sharedshare "github.com/websoft9/appos/backend/domain/share"
)

// ─── Collection names ─────────────────────────────────────────────────────────

const Collection = "user_files"

// ─── Format lists (static policy, not configurable) ──────────────────────────

const (
	// ReservedFolderNames are root-level folder names reserved by the system.
	ReservedFolderNames = "deploy,artifact"

	// PreviewMimeTypes is the whitelist of MIME types allowed for inline preview.
	// SVG is included — the frontend renders it via <img> which blocks JS execution.
	PreviewMimeTypes = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml," +
		"image/bmp,image/x-icon,application/pdf," +
		"audio/mpeg,audio/wav,audio/ogg,audio/aac,audio/flac,audio/webm," +
		"video/mp4,video/webm,video/ogg"

	// AllowedUploadFormats lists every extension that may be uploaded.
	AllowedUploadFormats = "txt,md,yaml,yml,json,sh,bash,zsh,fish,env,js,ts,jsx,tsx,mjs,cjs,vue,svelte," +
		"py,rb,go,rs,java,c,cpp,h,hpp,cc,cs,php,swift,kt,scala,groovy,lua,r,m,pl,pm," +
		"ex,exs,erl,hrl,clj,cljs,fs,fsx,ml,mli," +
		"css,scss,sass,less,html,htm,xml,svg,sql,graphql," +
		"toml,ini,cfg,conf,properties,gitignore,dockerignore,makefile,cmake," +
		"editorconfig,log,diff,patch,lock," +
		"pdf,doc,docx,xls,xlsx,ppt,pptx,odt,ods,odp"

	// EditableFormats is the subset of AllowedUploadFormats that supports online editing.
	EditableFormats = "txt,md,yaml,yml,json,sh,bash,zsh,fish,env,js,ts,jsx,tsx,mjs,cjs,vue,svelte," +
		"py,rb,go,rs,java,c,cpp,h,hpp,cc,cs,php,swift,kt,scala,groovy,lua,r,m,pl,pm," +
		"ex,exs,erl,hrl,clj,cljs,fs,fsx,ml,mli," +
		"css,scss,sass,less,html,htm,xml,svg,sql,graphql," +
		"toml,ini,cfg,conf,properties,gitignore,dockerignore,makefile,cmake," +
		"editorconfig,log,diff,patch"
)

// ─── UserFile aggregate ───────────────────────────────────────────────────────

// UserFile is the aggregate root for the Space domain.
// It wraps a PocketBase record and exposes typed domain accessors and invariants.
type UserFile struct {
	rec *core.Record
}

// From wraps a PocketBase record as a UserFile aggregate root.
func From(rec *core.Record) *UserFile {
	return &UserFile{rec: rec}
}

// Save persists the current aggregate state.
func (f *UserFile) Save(app core.App) error { return app.Save(f.rec) }

// ─── Identity and state accessors ────────────────────────────────────────────

func (f *UserFile) ID() string             { return f.rec.Id }
func (f *UserFile) Name() string           { return f.rec.GetString("name") }
func (f *UserFile) Owner() string          { return f.rec.GetString("owner") }
func (f *UserFile) MimeType() string       { return f.rec.GetString("mime_type") }
func (f *UserFile) Size() int              { return f.rec.GetInt("size") }
func (f *UserFile) IsFolder() bool         { return f.rec.GetBool("is_folder") }
func (f *UserFile) IsDeleted() bool        { return f.rec.GetBool("is_deleted") }
func (f *UserFile) Parent() string         { return f.rec.GetString("parent") }
func (f *UserFile) StoredFilename() string { return f.rec.GetString("content") }
func (f *UserFile) ShareToken() string     { return f.rec.GetString("share_token") }

// ShareExpiresAt parses and returns the share expiry time.
func (f *UserFile) ShareExpiresAt() (time.Time, error) {
	return sharedshare.ParseExpiry(f.rec.GetString("share_expires_at"))
}

// ─── Domain rules ────────────────────────────────────────────────────────────

// IsOwnedBy reports whether auth is the owner of this file.
func (f *UserFile) IsOwnedBy(auth *core.Record) bool {
	if auth == nil {
		return false
	}
	return f.rec.GetString("owner") == auth.Id
}

// IsOwnedByID reports ownership by raw user ID string.
func (f *UserFile) IsOwnedByID(userID string) bool {
	return f.rec.GetString("owner") == userID
}

// ValidateShareActive reports whether this file has an active (non-expired,
// non-revoked) share token. It returns a typed domain error when inactive.
func (f *UserFile) ValidateShareActive() error {
	return sharedshare.ValidateActive(
		f.rec.GetString("share_token"),
		f.rec.GetString("share_expires_at"),
		time.Now().UTC(),
	)
}

// ShareIsActive preserves the previous boolean API while delegating to typed errors.
func (f *UserFile) ShareIsActive() (bool, string) {
	if err := f.ValidateShareActive(); err != nil {
		return false, sharedshare.MessageForError(err)
	}
	return true, ""
}

// ApplyShare writes the share token and expiry from s onto the underlying record.
func (f *UserFile) ApplyShare(s sharedshare.Token) {
	f.rec.Set("share_token", s.Value())
	f.rec.Set("share_expires_at", s.ExpiresAt().Format(time.RFC3339))
}

// RevokeShare clears the share token and expiry from the underlying record.
func (f *UserFile) RevokeShare() {
	f.rec.Set("share_token", "")
	f.rec.Set("share_expires_at", "")
}

// IsPreviewable reports whether this file's MIME type is in the preview whitelist.
func (f *UserFile) IsPreviewable() bool {
	mt := f.rec.GetString("mime_type")
	if mt == "" {
		return false
	}
	for _, allowed := range strings.Split(PreviewMimeTypes, ",") {
		if strings.TrimSpace(allowed) == mt {
			return true
		}
	}
	return false
}

// EffectiveMimeType returns mime_type, falling back to "application/octet-stream".
func (f *UserFile) EffectiveMimeType() string {
	mt := f.rec.GetString("mime_type")
	if mt == "" {
		return "application/octet-stream"
	}
	return mt
}

// EffectiveDisplayName returns name, falling back to the stored filename.
func (f *UserFile) EffectiveDisplayName() string {
	name := f.rec.GetString("name")
	if name == "" {
		return f.rec.GetString("content")
	}
	return name
}
