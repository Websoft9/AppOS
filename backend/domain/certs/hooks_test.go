package certs

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

func TestValidatePrivateKeySecretRef(t *testing.T) {
	secretCol := core.NewBaseCollection("secrets")

	newSecret := func(name, templateID, status string) *core.Record {
		t.Helper()
		rec := core.NewRecord(secretCol)
		rec.Id = name
		rec.Set("name", name)
		rec.Set("template_id", templateID)
		rec.Set("status", status)
		return rec
	}

	t.Run("allows empty relation", func(t *testing.T) {
		if err := validatePrivateKeySecretRefWith("", "user-1", func(string, string) error { return nil }, func(string) (*core.Record, error) {
			return nil, nil
		}); err != nil {
			t.Fatalf("expected nil error, got %v", err)
		}
	})

	t.Run("accepts accessible tls private key secret", func(t *testing.T) {
		secret := newSecret("tls-key", "tls_private_key", "active")
		if err := validatePrivateKeySecretRefWith(secret.Id, "user-1", func(string, string) error { return nil }, func(string) (*core.Record, error) {
			return secret, nil
		}); err != nil {
			t.Fatalf("expected nil error, got %v", err)
		}
	})

	t.Run("rejects non tls-private-key secret", func(t *testing.T) {
		secret := newSecret("token", "single_value", "active")
		err := validatePrivateKeySecretRefWith(secret.Id, "user-1", func(string, string) error { return nil }, func(string) (*core.Record, error) {
			return secret, nil
		})
		if err == nil {
			t.Fatal("expected error for non-tls-private-key secret")
		}
		if err.Error() != "certificate key must reference a tls_private_key secret" {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("rejects inaccessible private secret", func(t *testing.T) {
		secret := newSecret("private-tls-key", "tls_private_key", "active")
		err := validatePrivateKeySecretRefWith(secret.Id, "other-user", func(string, string) error {
			return errors.New("denied")
		}, func(string) (*core.Record, error) {
			return secret, nil
		})
		if err == nil {
			t.Fatal("expected error for inaccessible secret")
		}
		if err.Error() != "invalid private key secret" {
			t.Fatalf("unexpected error: %v", err)
		}
	})
}
