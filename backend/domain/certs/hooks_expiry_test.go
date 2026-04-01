package certs

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func TestExpireDueCertificates(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	col, err := app.FindCollectionByNameOrId("certificates")
	if err != nil {
		t.Fatal(err)
	}

	newCert := func(name, status string, expiresAt time.Time) *core.Record {
		rec := core.NewRecord(col)
		rec.Set("name", name)
		rec.Set("domain", "test.example.com")
		rec.Set("kind", "self_signed")
		rec.Set("status", status)
		if !expiresAt.IsZero() {
			rec.Set("expires_at", expiresAt.UTC().Format(time.RFC3339))
		}
		if err := app.Save(rec); err != nil {
			t.Fatalf("save certificate %s: %v", name, err)
		}
		return rec
	}

	expiredActive := newCert("expired-active", "active", time.Now().Add(-2*time.Hour))
	futureActive := newCert("future-active", "active", time.Now().Add(48*time.Hour))
	alreadyExpired := newCert("already-expired", "expired", time.Now().Add(-24*time.Hour))
	noExpires := newCert("no-expires", "active", time.Time{})

	if err := expireDueCertificates(app); err != nil {
		t.Fatalf("expireDueCertificates returned error: %v", err)
	}

	assertStatus := func(id, want string) {
		t.Helper()
		rec, findErr := app.FindRecordById("certificates", id)
		if findErr != nil {
			t.Fatalf("find certificate %s: %v", id, findErr)
		}
		got := rec.GetString("status")
		if got != want {
			t.Fatalf("status mismatch for %s: want %q, got %q", id, want, got)
		}
	}

	assertStatus(expiredActive.Id, "expired")
	assertStatus(futureActive.Id, "active")
	assertStatus(alreadyExpired.Id, "expired")
	assertStatus(noExpires.Id, "active")
}
