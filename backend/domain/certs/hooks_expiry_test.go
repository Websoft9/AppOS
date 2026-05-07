package certs

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func TestExpireDueCertificates(t *testing.T) {
	col := core.NewBaseCollection("certificates")
	now := time.Now().UTC()

	newCert := func(name, status string, expiresAt time.Time) *core.Record {
		rec := core.NewRecord(col)
		rec.Id = name
		rec.Set("name", name)
		rec.Set("domain", "test.example.com")
		rec.Set("kind", "self_signed")
		rec.Set("status", status)
		if !expiresAt.IsZero() {
			rec.Set("expires_at", expiresAt.UTC().Format(time.RFC3339))
		}
		return rec
	}

	expiredActive := newCert("expired-active", "active", now.Add(-2*time.Hour))
	futureActive := newCert("future-active", "active", now.Add(48*time.Hour))
	alreadyExpired := newCert("already-expired", "expired", now.Add(-24*time.Hour))
	noExpires := newCert("no-expires", "active", time.Time{})

	markExpiredCertificates([]*core.Record{expiredActive, futureActive, alreadyExpired, noExpires}, now)

	assertStatus := func(rec *core.Record, want string) {
		t.Helper()
		got := rec.GetString("status")
		if got != want {
			t.Fatalf("status mismatch for %s: want %q, got %q", rec.Id, want, got)
		}
	}

	assertStatus(expiredActive, "expired")
	assertStatus(futureActive, "active")
	assertStatus(alreadyExpired, "expired")
	assertStatus(noExpires, "active")
}
