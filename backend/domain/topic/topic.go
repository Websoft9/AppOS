// Package topic implements the Topic aggregate and its domain rules.
//
// A Topic is a shared-first discussion thread: users write content, add
// comments, share with external viewers via time-limited tokens, and archive
// (close) the thread when discussion ends.
//
// Domain boundary: this package must not import backend/infra or backend/platform.
// PocketBase core is treated as a shared foundation layer.
package topic

import (
	"errors"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// errShareNoExpiry is a sentinel returned by ShareExpiresAt when the field is absent or blank.
var errShareNoExpiry = errors.New("share link has no expiry set")

// ─── Constants ───────────────────────────────────────────────────────────────

const (
	// Collection names — referenced by route handlers and migrations.
	Collection         = "topics"
	CommentsCollection = "topic_comments"

	// GuestAuthorPrefix identifies anonymous comment authors stored as "guest:<name>".
	GuestAuthorPrefix = "guest:"
	DefaultGuestName  = "Guest"

	// Comment body limits.
	MaxCommentBodyLen  = 10_000
	MaxGuestNameLen    = 100
)

// ─── Topic aggregate ─────────────────────────────────────────────────────────

// Topic is the aggregate root for a shared discussion thread.
// It wraps a PocketBase record and exposes domain accessors and invariants.
// Callers should obtain a Topic via From and use its methods for all
// domain-level decisions instead of inspecting raw Record fields directly.
type Topic struct {
	rec *core.Record
}

// From wraps a PocketBase record as a Topic aggregate root.
func From(rec *core.Record) *Topic {
	return &Topic{rec: rec}
}

// Record returns the underlying PocketBase record for persistence operations.
func (t *Topic) Record() *core.Record { return t.rec }

// ─── Identity and state accessors ────────────────────────────────────────────

func (t *Topic) ID() string          { return t.rec.Id }
func (t *Topic) Title() string       { return t.rec.GetString("title") }
func (t *Topic) Description() string { return t.rec.GetString("description") }
func (t *Topic) CreatedBy() string   { return t.rec.GetString("created_by") }
func (t *Topic) IsClosed() bool { return t.rec.GetBool("closed") }

// ShareExpiresAt parses and returns the share expiry time.
// Returns the zero time and a non-nil error if the field is absent or unparseable.
func (t *Topic) ShareExpiresAt() (time.Time, error) {
	raw := t.rec.GetString("share_expires_at")
	if raw == "" {
		return time.Time{}, errShareNoExpiry
	}
	return time.Parse(time.RFC3339, raw)
}

// ─── Domain rules ────────────────────────────────────────────────────────────

// IsOwnedBy reports whether auth is the creator of this topic and may perform
// owner-only operations such as creating or revoking a share link.
func (t *Topic) IsOwnedBy(auth *core.Record) bool {
	if auth == nil {
		return false
	}
	return t.rec.GetString("created_by") == auth.Id
}

// ShareIsActive reports whether this topic has an active (non-expired, non-revoked)
// share token. Returns (true, nil) when active; returns (false, reason) otherwise.
func (t *Topic) ShareIsActive() (bool, string) {
	token := t.rec.GetString("share_token")
	if token == "" {
		return false, "share link has been revoked"
	}
	expiresAt, err := t.ShareExpiresAt()
	if err != nil {
		return false, "share link has no expiry set"
	}
	if time.Now().UTC().After(expiresAt) {
		return false, "share link has expired"
	}
	return true, ""
}

// ─── Comment entity ──────────────────────────────────────────────────────────

// Comment represents a single comment on a Topic.
// It wraps a PocketBase record and is an entity within the Topic aggregate.
type Comment struct {
	rec *core.Record
}

// CommentFrom wraps a PocketBase record as a Comment entity.
func CommentFrom(rec *core.Record) *Comment {
	return &Comment{rec: rec}
}

// Record returns the underlying PocketBase record for persistence operations.
func (c *Comment) Record() *core.Record { return c.rec }

func (c *Comment) ID() string        { return c.rec.Id }
func (c *Comment) TopicID() string   { return c.rec.GetString("topic_id") }
func (c *Comment) Body() string      { return c.rec.GetString("body") }
func (c *Comment) CreatedBy() string { return c.rec.GetString("created_by") }
func (c *Comment) Created() string   { return c.rec.GetString("created") }
func (c *Comment) Updated() string   { return c.rec.GetString("updated") }

// IsGuest reports whether this comment was posted by an anonymous guest
// (created via a share link rather than by an authenticated user).
func (c *Comment) IsGuest() bool {
	return strings.HasPrefix(c.rec.GetString("created_by"), GuestAuthorPrefix)
}

// GuestName returns the display name of the anonymous author.
// Returns an empty string when IsGuest is false.
func (c *Comment) GuestName() string {
	raw := c.rec.GetString("created_by")
	if !strings.HasPrefix(raw, GuestAuthorPrefix) {
		return ""
	}
	return strings.TrimPrefix(raw, GuestAuthorPrefix)
}
