package topics

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	sharedshare "github.com/websoft9/appos/backend/domain/share"
)

func newTopicRecord() *core.Record {
	rec := core.NewRecord(core.NewBaseCollection(Collection))
	rec.Set("created_by", "owner-1")
	return rec
}

func TestNewGuestCommentUsesCharacterLimits(t *testing.T) {
	topic := From(newTopicRecord())
	comments := core.NewBaseCollection(CommentsCollection)

	guestName := strings.Repeat("你", MaxGuestNameLen)
	comment, err := topic.NewGuestComment(comments, "你好", guestName)
	if err != nil {
		t.Fatalf("expected %d-character guest name to be accepted, got error: %v", MaxGuestNameLen, err)
	}
	if comment.CreatedBy() != GuestAuthorID(guestName) {
		t.Fatalf("expected created_by to preserve multibyte guest name, got %q", comment.CreatedBy())
	}

	_, err = topic.NewGuestComment(comments, "你好", strings.Repeat("你", MaxGuestNameLen+1))
	if err == nil {
		t.Fatalf("expected %d+1-character guest name to be rejected", MaxGuestNameLen)
	}
}

func TestNewGuestCommentDefaultsGuestName(t *testing.T) {
	topic := From(newTopicRecord())
	comments := core.NewBaseCollection(CommentsCollection)

	comment, err := topic.NewGuestComment(comments, "hello", "")
	if err != nil {
		t.Fatalf("expected empty guest name to default, got error: %v", err)
	}
	if comment.CreatedBy() != GuestAuthorID(DefaultGuestName) {
		t.Fatalf("expected default guest author id, got %q", comment.CreatedBy())
	}
}

func TestValidateShareActiveReturnsTypedErrors(t *testing.T) {
	topic := From(newTopicRecord())

	if err := topic.ValidateShareActive(); !errors.Is(err, sharedshare.ErrRevoked) {
		t.Fatalf("expected revoked share error, got %v", err)
	}

	topic.ApplyShare(sharedshare.RestoreToken("token", time.Now().UTC().Add(-time.Minute)))
	if err := topic.ValidateShareActive(); !errors.Is(err, sharedshare.ErrExpired) {
		t.Fatalf("expected expired share error, got %v", err)
	}

	topic.ApplyShare(sharedshare.RestoreToken("token", time.Now().UTC().Add(time.Minute)))
	if err := topic.ValidateShareActive(); err != nil {
		t.Fatalf("expected active share, got %v", err)
	}
}

func TestNewGuestCommentReturnsTypedErrors(t *testing.T) {
	topic := From(newTopicRecord())
	comments := core.NewBaseCollection(CommentsCollection)

	_, err := topic.NewGuestComment(comments, "", "Guest")
	if !errors.Is(err, ErrCommentBodyInvalid) {
		t.Fatalf("expected typed comment body error, got %v", err)
	}

	_, err = topic.NewGuestComment(comments, "hello", strings.Repeat("你", MaxGuestNameLen+1))
	if !errors.Is(err, ErrGuestNameTooLong) {
		t.Fatalf("expected typed guest name error, got %v", err)
	}
}
