package certs

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func TestValidatePrivateKeySecretRef(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	secretCol, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}

	newSecret := func(name, templateID, scope, createdBy, status string) string {
		t.Helper()
		rec := core.NewRecord(secretCol)
		rec.Set("name", name)
		rec.Set("template_id", templateID)
		rec.Set("scope", scope)
		rec.Set("created_by", createdBy)
		rec.Set("status", status)
		if err := app.Save(rec); err != nil {
			t.Fatalf("save secret %s: %v", name, err)
		}
		return rec.Id
	}

	t.Run("allows empty relation", func(t *testing.T) {
		if err := validatePrivateKeySecretRef(app, "", "user-1"); err != nil {
			t.Fatalf("expected nil error, got %v", err)
		}
	})

	t.Run("accepts accessible tls private key secret", func(t *testing.T) {
		secretID := newSecret("tls-key", "tls_private_key", "global", "owner-1", "active")
		if err := validatePrivateKeySecretRef(app, secretID, "user-1"); err != nil {
			t.Fatalf("expected nil error, got %v", err)
		}
	})

	t.Run("rejects non tls-private-key secret", func(t *testing.T) {
		secretID := newSecret("token", "single_value", "global", "owner-1", "active")
		err := validatePrivateKeySecretRef(app, secretID, "user-1")
		if err == nil {
			t.Fatal("expected error for non-tls-private-key secret")
		}
		if err.Error() != "certificate key must reference a tls_private_key secret" {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("rejects inaccessible private secret", func(t *testing.T) {
		secretID := newSecret("private-tls-key", "tls_private_key", "user_private", "owner-1", "active")
		err := validatePrivateKeySecretRef(app, secretID, "other-user")
		if err == nil {
			t.Fatal("expected error for inaccessible secret")
		}
		if err.Error() != "invalid private key secret" {
			t.Fatalf("unexpected error: %v", err)
		}
	})
}
