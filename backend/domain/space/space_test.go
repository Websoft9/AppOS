package space

import (
	"errors"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	sharedshare "github.com/websoft9/appos/backend/domain/share"
)

func newUserFileRecord() *core.Record {
	rec := core.NewRecord(core.NewBaseCollection(Collection))
	rec.Set("owner", "owner-1")
	rec.Set("name", "demo.txt")
	rec.Set("mime_type", "text/plain")
	return rec
}

func TestValidateShareActiveReturnsTypedErrors(t *testing.T) {
	uf := From(newUserFileRecord())

	if err := uf.ValidateShareActive(); !errors.Is(err, sharedshare.ErrRevoked) {
		t.Fatalf("expected revoked share error, got %v", err)
	}

	uf.ApplyShare(sharedshare.RestoreToken("token", time.Now().UTC().Add(-time.Minute)))
	if err := uf.ValidateShareActive(); !errors.Is(err, sharedshare.ErrExpired) {
		t.Fatalf("expected expired share error, got %v", err)
	}

	uf.ApplyShare(sharedshare.RestoreToken("token", time.Now().UTC().Add(time.Minute)))
	if err := uf.ValidateShareActive(); err != nil {
		t.Fatalf("expected active share, got %v", err)
	}
}

func TestMessageForErrorReturnsCanonicalMessages(t *testing.T) {
	if got := sharedshare.MessageForError(sharedshare.ErrRevoked); got != "share link has been revoked" {
		t.Fatalf("expected revoked message, got %q", got)
	}
	if got := sharedshare.MessageForError(sharedshare.ErrExpired); got != "share link has expired" {
		t.Fatalf("expected expired message, got %q", got)
	}
}
