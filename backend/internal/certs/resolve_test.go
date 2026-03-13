package certs_test

import (
	"encoding/base64"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	// trigger init() migration registrations
	_ "github.com/websoft9/appos/backend/internal/migrations"

	"github.com/websoft9/appos/backend/internal/certs"
	"github.com/websoft9/appos/backend/internal/secrets"
)

func TestResolveCertificate(t *testing.T) {
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	t.Setenv(secrets.EnvSecretKey, key)
	if err := secrets.LoadKeyFromEnv(); err != nil {
		t.Fatalf("load secret key: %v", err)
	}

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	// Create a minimal active certificate record with cert_pem
	certPEM, _, err := certs.GenerateSelfSigned("test.example.com", 2048, 365)
	if err != nil {
		t.Fatal("failed to generate self-signed cert:", err)
	}

	col, err := app.FindCollectionByNameOrId("certificates")
	if err != nil {
		t.Fatal(err)
	}

	newRecord := func(name, status, pem string) *core.Record {
		rec := core.NewRecord(col)
		rec.Set("name", name)
		rec.Set("domain", "test.example.com")
		rec.Set("kind", "self_signed")
		rec.Set("status", status)
		rec.Set("cert_pem", pem)
		rec.Set("expires_at", time.Now().Add(365*24*time.Hour).Format(time.RFC3339))
		if err := app.Save(rec); err != nil {
			t.Fatalf("save record: %v", err)
		}
		return rec
	}

	newSecret := func(name string, payload map[string]any) string {
		secretCol, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			t.Fatalf("find secrets collection: %v", err)
		}
		rec := core.NewRecord(secretCol)
		rec.Set("name", name)
		rec.Set("template_id", "tls_private_key")
		rec.Set("scope", "global")
		rec.Set("access_mode", "use_only")
		rec.Set("status", "active")
		rec.Set("created_by", "")
		rec.Set("version", 1)

		enc, err := secrets.EncryptPayload(payload)
		if err != nil {
			t.Fatalf("encrypt payload: %v", err)
		}
		rec.Set("payload_encrypted", enc)

		if err := app.Save(rec); err != nil {
			t.Fatalf("save secret: %v", err)
		}

		return rec.Id
	}

	t.Run("happy path — active with cert_pem, no key", func(t *testing.T) {
		rec := newRecord("test-resolve-active", "active", certPEM)
		mat, err := certs.ResolveCertificate(app, rec.Id, "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if mat.CertID != rec.Id {
			t.Errorf("expected CertID %q, got %q", rec.Id, mat.CertID)
		}
		if mat.CertPEM == "" {
			t.Error("expected non-empty CertPEM")
		}
		if mat.KeyPEM != "" {
			t.Errorf("expected empty KeyPEM when no key relation, got %q", mat.KeyPEM)
		}
	})

	t.Run("happy path — active with key relation", func(t *testing.T) {
		secretID := newSecret("test-resolve-key", map[string]any{"private_key": "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"})
		rec := newRecord("test-resolve-with-key", "active", certPEM)
		rec.Set("key", secretID)
		if err := app.Save(rec); err != nil {
			t.Fatalf("save record with key: %v", err)
		}

		mat, err := certs.ResolveCertificate(app, rec.Id, "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if mat.KeyPEM == "" {
			t.Fatal("expected non-empty KeyPEM")
		}
	})

	t.Run("key relation payload missing private_key returns error", func(t *testing.T) {
		secretID := newSecret("test-resolve-missing-private-key", map[string]any{"value": "x"})
		rec := newRecord("test-resolve-bad-key", "active", certPEM)
		rec.Set("key", secretID)
		if err := app.Save(rec); err != nil {
			t.Fatalf("save record with key: %v", err)
		}

		_, err := certs.ResolveCertificate(app, rec.Id, "")
		if err == nil {
			t.Fatal("expected error when private_key is missing")
		}
	})

	t.Run("not active — expired returns ErrCertNotActive", func(t *testing.T) {
		rec := newRecord("test-resolve-expired", "expired", certPEM)
		_, err := certs.ResolveCertificate(app, rec.Id, "")
		if err != certs.ErrCertNotActive {
			t.Errorf("expected ErrCertNotActive, got %v", err)
		}
	})

	t.Run("not ready — active but no cert_pem returns ErrCertNotReady", func(t *testing.T) {
		rec := newRecord("test-resolve-nokey", "active", "")
		_, err := certs.ResolveCertificate(app, rec.Id, "")
		if err != certs.ErrCertNotReady {
			t.Errorf("expected ErrCertNotReady, got %v", err)
		}
	})

	t.Run("not found — unknown ID returns ErrCertNotFound", func(t *testing.T) {
		_, err := certs.ResolveCertificate(app, "nonexistent000000", "")
		if err != certs.ErrCertNotFound {
			t.Errorf("expected ErrCertNotFound, got %v", err)
		}
	})
}
