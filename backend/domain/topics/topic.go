// Package topics implements the Topic aggregate and its domain rules.
//
// A Topic is a shared-first discussion thread: users write content, add
// comments, share with external viewers via time-limited tokens, and archive
// (close) the thread when discussion ends.
//
// Domain boundary: this package must not import backend/infra or backend/platform.
// PocketBase core is treated as a shared foundation layer.
package topics

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/pocketbase/pocketbase/core"
	sharedshare "github.com/websoft9/appos/backend/domain/share"
)

// Topic-local domain errors. Shared share lifecycle errors live in domain/share.
var (
	ErrTopicClosed        = errors.New("topic is closed")
	ErrCommentBodyInvalid = errors.New("comment body invalid")
	ErrGuestNameTooLong   = errors.New("guest name too long")
)

// MessageForTopicError returns the canonical user-facing message for topic-local
// errors and delegates shared share lifecycle errors to the shared kernel.
func MessageForTopicError(err error) string {
	switch {
	case errors.Is(err, ErrTopicClosed):
		return "This topic is closed"
	case errors.Is(err, ErrCommentBodyInvalid):
		return fmt.Sprintf("comment body is required and must be at most %d characters", MaxCommentBodyLen)
	case errors.Is(err, ErrGuestNameTooLong):
		return fmt.Sprintf("guest name must be at most %d characters", MaxGuestNameLen)
	default:
		return sharedshare.MessageForError(err)
	}
}

// ─── Constants ───────────────────────────────────────────────────────────────

const (
	// Collection names — referenced by route handlers and migrations.
	Collection         = "topics"
	CommentsCollection = "topic_comments"

	// GuestAuthorPrefix identifies anonymous comment authors stored as "guest:<name>".
	GuestAuthorPrefix = "guest:"
	DefaultGuestName  = "Guest"

	// Comment body limits.
	MaxCommentBodyLen = 10_000
	MaxGuestNameLen   = 100
)

// GuestAuthorID returns the stored "created_by" identifier for an anonymous guest.
func GuestAuthorID(name string) string { return GuestAuthorPrefix + name }

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

// Save persists the current aggregate state.
func (t *Topic) Save(app core.App) error { return app.Save(t.rec) }

// ─── Identity and state accessors ────────────────────────────────────────────

func (t *Topic) ID() string          { return t.rec.Id }
func (t *Topic) Title() string       { return t.rec.GetString("title") }
func (t *Topic) Description() string { return t.rec.GetString("description") }
func (t *Topic) CreatedBy() string   { return t.rec.GetString("created_by") }
func (t *Topic) IsClosed() bool      { return t.rec.GetBool("closed") }

// ShareExpiresAt parses and returns the share expiry time.
// Returns the zero time and a non-nil error if the field is absent or unparseable.
func (t *Topic) ShareExpiresAt() (time.Time, error) {
	return sharedshare.ParseExpiry(t.rec.GetString("share_expires_at"))
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

// ValidateShareActive reports whether this topic has an active (non-expired,
// non-revoked) share token. It returns a typed domain error when inactive.
func (t *Topic) ValidateShareActive() error {
	return sharedshare.ValidateActive(
		t.rec.GetString("share_token"),
		t.rec.GetString("share_expires_at"),
		time.Now().UTC(),
	)
}

// ShareIsActive preserves the previous boolean API while delegating to typed errors.
func (t *Topic) ShareIsActive() (bool, string) {
	if err := t.ValidateShareActive(); err != nil {
		return false, MessageForTopicError(err)
	}
	return true, ""
}

// ─── Share state mutation ───────────────────────────────────────────────────

// ApplyShare writes the share token and expiry from s onto the underlying record.
func (t *Topic) ApplyShare(s sharedshare.Token) {
	t.rec.Set("share_token", s.Value())
	t.rec.Set("share_expires_at", s.ExpiresAt().Format(time.RFC3339))
}

// RevokeShare clears the share token and expiry from the underlying record.
func (t *Topic) RevokeShare() {
	t.rec.Set("share_token", "")
	t.rec.Set("share_expires_at", "")
}

// EnsureOpen reports whether the topic is still open for new comments.
func (t *Topic) EnsureOpen() error {
	if t.IsClosed() {
		return ErrTopicClosed
	}
	return nil
}

// ─── Comment policy ─────────────────────────────────────────────────────────

// NewGuestComment creates a validated Comment record within this topic posted
// by an anonymous guest via a share link.
// Returns an error if body or guestName fail domain invariants.
func (t *Topic) NewGuestComment(col *core.Collection, body, guestName string) (*Comment, error) {
	bodyLen := utf8.RuneCountInString(body)
	if bodyLen == 0 || bodyLen > MaxCommentBodyLen {
		return nil, ErrCommentBodyInvalid
	}
	if guestName == "" {
		guestName = DefaultGuestName
	}
	if utf8.RuneCountInString(guestName) > MaxGuestNameLen {
		return nil, ErrGuestNameTooLong
	}
	rec := core.NewRecord(col)
	rec.Set("topic_id", t.rec.Id)
	rec.Set("body", body)
	rec.Set("created_by", GuestAuthorID(guestName))
	return &Comment{rec: rec}, nil
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

// Save persists the current comment state.
func (c *Comment) Save(app core.App) error { return app.Save(c.rec) }

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
