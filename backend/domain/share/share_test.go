package share

import (
	"errors"
	"testing"
	"time"
)

func TestValidateActiveReturnsTypedErrors(t *testing.T) {
	now := time.Now().UTC()

	if err := ValidateActive("", now.Add(time.Minute).Format(time.RFC3339), now); !errors.Is(err, ErrRevoked) {
		t.Fatalf("expected revoked error, got %v", err)
	}
	if err := ValidateActive("token", "", now); !errors.Is(err, ErrNoExpiry) {
		t.Fatalf("expected no-expiry error, got %v", err)
	}
	if err := ValidateActive("token", now.Add(-time.Minute).Format(time.RFC3339), now); !errors.Is(err, ErrExpired) {
		t.Fatalf("expected expired error, got %v", err)
	}
	if err := ValidateActive("token", now.Add(time.Minute).Format(time.RFC3339), now); err != nil {
		t.Fatalf("expected active share, got %v", err)
	}
}

func TestMessageForErrorReturnsCanonicalMessages(t *testing.T) {
	if got := MessageForError(ErrRevoked); got != "share link has been revoked" {
		t.Fatalf("expected revoked message, got %q", got)
	}
	if got := MessageForError(ErrExpired); got != "share link has expired" {
		t.Fatalf("expected expired message, got %q", got)
	}
}
