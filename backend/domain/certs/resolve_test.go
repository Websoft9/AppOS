package certs

import (
	"database/sql"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/secrets"
)

func TestResolveCertificate(t *testing.T) {
	certPEM, _, err := GenerateSelfSigned("test.example.com", 2048, 365)
	if err != nil {
		t.Fatal("failed to generate self-signed cert:", err)
	}

	col := core.NewBaseCollection("certificates")
	records := map[string]*core.Record{}
	secretsByID := map[string]*secrets.ResolveResult{}

	newRecord := func(name, status, pem string) *core.Record {
		rec := core.NewRecord(col)
		rec.Id = name
		rec.Set("name", name)
		rec.Set("domain", "test.example.com")
		rec.Set("kind", "self_signed")
		rec.Set("status", status)
		rec.Set("cert_pem", pem)
		records[rec.Id] = rec
		return rec
	}

	newSecret := func(name string, payload map[string]any) string {
		secretsByID[name] = &secrets.ResolveResult{Payload: payload}
		return name
	}

	findCertificate := func(certID string) (*core.Record, error) {
		rec, ok := records[certID]
		if !ok {
			return nil, sql.ErrNoRows
		}
		return rec, nil
	}

	resolveSecret := func(secretID, callerID string) (*secrets.ResolveResult, error) {
		result, ok := secretsByID[secretID]
		if !ok {
			return nil, sql.ErrNoRows
		}
		return result, nil
	}

	t.Run("happy path — active with cert_pem, no key", func(t *testing.T) {
		rec := newRecord("test-resolve-active", "active", certPEM)
		mat, err := resolveCertificateWith(rec.Id, "", findCertificate, resolveSecret)
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

	t.Run("happy path — active with private_key_secret relation", func(t *testing.T) {
		secretID := newSecret("test-resolve-key", map[string]any{"private_key": "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"})
		rec := newRecord("test-resolve-with-key", "active", certPEM)
		rec.Set("private_key_secret", secretID)

		mat, err := resolveCertificateWith(rec.Id, "", findCertificate, resolveSecret)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if mat.KeyPEM == "" {
			t.Fatal("expected non-empty KeyPEM")
		}
	})

	t.Run("legacy key relation still resolves during transition", func(t *testing.T) {
		secretID := newSecret("test-resolve-legacy-key", map[string]any{"private_key": "-----BEGIN PRIVATE KEY-----\nlegacy\n-----END PRIVATE KEY-----"})
		rec := newRecord("test-resolve-legacy-key", "active", certPEM)
		rec.Set("key", secretID)

		mat, err := resolveCertificateWith(rec.Id, "", findCertificate, resolveSecret)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if mat.KeyPEM == "" {
			t.Fatal("expected non-empty KeyPEM")
		}
	})

	t.Run("private_key_secret payload missing private_key returns error", func(t *testing.T) {
		secretID := newSecret("test-resolve-missing-private-key", map[string]any{"value": "x"})
		rec := newRecord("test-resolve-bad-key", "active", certPEM)
		rec.Set("private_key_secret", secretID)

		_, err := resolveCertificateWith(rec.Id, "", findCertificate, resolveSecret)
		if err == nil {
			t.Fatal("expected error when private_key is missing")
		}
	})

	t.Run("not active — expired returns ErrCertNotActive", func(t *testing.T) {
		rec := newRecord("test-resolve-expired", "expired", certPEM)
		_, err := resolveCertificateWith(rec.Id, "", findCertificate, resolveSecret)
		if err != ErrCertNotActive {
			t.Errorf("expected ErrCertNotActive, got %v", err)
		}
	})

	t.Run("not ready — active but no cert_pem returns ErrCertNotReady", func(t *testing.T) {
		rec := newRecord("test-resolve-nokey", "active", "")
		_, err := resolveCertificateWith(rec.Id, "", findCertificate, resolveSecret)
		if err != ErrCertNotReady {
			t.Errorf("expected ErrCertNotReady, got %v", err)
		}
	})

	t.Run("not found — unknown ID returns ErrCertNotFound", func(t *testing.T) {
		_, err := resolveCertificateWith("nonexistent000000", "", findCertificate, resolveSecret)
		if err != ErrCertNotFound {
			t.Errorf("expected ErrCertNotFound, got %v", err)
		}
	})
}
