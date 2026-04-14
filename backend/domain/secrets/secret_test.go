package secrets

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func newSecretRecord(t *testing.T) (*tests.TestApp, *core.Record) {
	t.Helper()
	app := newSecretsApp(t)
	col, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	return app, core.NewRecord(col)
}

func TestExpiresAt_Empty(t *testing.T) {
	app, rec := newSecretRecord(t)
	defer app.Cleanup()

	s := From(rec)
	if !s.ExpiresAt().IsZero() {
		t.Fatal("expected zero time when expires_at is empty")
	}
}

func TestExpiresAt_Valid(t *testing.T) {
	app, rec := newSecretRecord(t)
	defer app.Cleanup()

	future := time.Now().UTC().Add(48 * time.Hour).Truncate(time.Second)
	rec.Set("expires_at", future.Format(time.RFC3339))

	s := From(rec)
	if got := s.ExpiresAt(); !got.Equal(future) {
		t.Fatalf("expected %v, got %v", future, got)
	}
}

func TestIsExpired_NoExpiry(t *testing.T) {
	app, rec := newSecretRecord(t)
	defer app.Cleanup()

	if From(rec).IsExpired() {
		t.Fatal("secret with no expiry should not be expired")
	}
}

func TestIsExpired_Future(t *testing.T) {
	app, rec := newSecretRecord(t)
	defer app.Cleanup()

	rec.Set("expires_at", time.Now().UTC().Add(24*time.Hour).Format(time.RFC3339))
	if From(rec).IsExpired() {
		t.Fatal("secret expiring in the future should not be expired")
	}
}

func TestIsExpired_Past(t *testing.T) {
	app, rec := newSecretRecord(t)
	defer app.Cleanup()

	rec.Set("expires_at", time.Now().UTC().Add(-time.Second).Format(time.RFC3339))
	if !From(rec).IsExpired() {
		t.Fatal("secret with past expiry should be expired")
	}
}

func TestIsExpiringSoon_ZeroWarnDays(t *testing.T) {
	app, rec := newSecretRecord(t)
	defer app.Cleanup()

	rec.Set("expires_at", time.Now().UTC().Add(2*time.Hour).Format(time.RFC3339))
	if From(rec).IsExpiringSoon(0) {
		t.Fatal("warnDays=0 should never trigger expiring-soon")
	}
}

func TestIsExpiringSoon_NoExpiry(t *testing.T) {
	app, rec := newSecretRecord(t)
	defer app.Cleanup()

	if From(rec).IsExpiringSoon(7) {
		t.Fatal("secret with no expiry should never be expiring-soon")
	}
}

func TestIsExpiringSoon_WithinWindow(t *testing.T) {
	app, rec := newSecretRecord(t)
	defer app.Cleanup()

	rec.Set("expires_at", time.Now().UTC().Add(3*24*time.Hour).Format(time.RFC3339))
	if !From(rec).IsExpiringSoon(7) {
		t.Fatal("secret expiring in 3 days should be expiring soon with 7-day window")
	}
}

func TestIsExpiringSoon_OutsideWindow(t *testing.T) {
	app, rec := newSecretRecord(t)
	defer app.Cleanup()

	rec.Set("expires_at", time.Now().UTC().Add(30*24*time.Hour).Format(time.RFC3339))
	if From(rec).IsExpiringSoon(7) {
		t.Fatal("secret expiring in 30 days should not be expiring soon with 7-day window")
	}
}

// ─── CanBindByUser ────────────────────────────────────────────────────────────

func TestCanBindByUser_EmptyUserID(t *testing.T) {
	app, rec := newSecretRecord(t)
	defer app.Cleanup()

	rec.Set("scope", ScopeGlobal)
	if From(rec).CanBindByUser("") {
		t.Fatal("empty userID should never bind")
	}
}

func TestCanBindByUser_WhitespaceUserID(t *testing.T) {
	app, rec := newSecretRecord(t)
	defer app.Cleanup()

	rec.Set("scope", ScopeGlobal)
	if From(rec).CanBindByUser("   ") {
		t.Fatal("whitespace-only userID should never bind")
	}
}

func TestCanBindByUser_GlobalAllows(t *testing.T) {
	app, rec := newSecretRecord(t)
	defer app.Cleanup()

	rec.Set("scope", ScopeGlobal)
	rec.Set("created_by", "owner1")
	if !From(rec).CanBindByUser("other-user") {
		t.Fatal("global scope should allow any non-empty userID")
	}
}

func TestCanBindByUser_UserPrivateOwner(t *testing.T) {
	app, rec := newSecretRecord(t)
	defer app.Cleanup()

	rec.Set("scope", ScopeUserPrivate)
	rec.Set("created_by", "user42")
	if !From(rec).CanBindByUser("user42") {
		t.Fatal("user_private scope should allow the owner")
	}
}

func TestCanBindByUser_UserPrivateNonOwner(t *testing.T) {
	app, rec := newSecretRecord(t)
	defer app.Cleanup()

	rec.Set("scope", ScopeUserPrivate)
	rec.Set("created_by", "user42")
	if From(rec).CanBindByUser("other-user") {
		t.Fatal("user_private scope should reject non-owner")
	}
}
