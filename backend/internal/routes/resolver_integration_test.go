package routes

import (
	"encoding/base64"
	"path/filepath"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/internal/secrets"

	_ "github.com/websoft9/appos/backend/internal/migrations"
)

// resolverTestEnv extends newSecretsTestEnv to provide helpers for creating
// secret records that exercise secrets.Resolve / secrets.ValidateRef.
func resolverTestEnv(t *testing.T) *testEnv {
	t.Helper()
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	t.Setenv(secrets.EnvSecretKey, key)
	if err := secrets.LoadKeyFromEnv(); err != nil {
		t.Fatal(err)
	}
	if err := secrets.LoadTemplatesFromFile(filepath.Clean("/data/dev/appos/backend/internal/secrets/templates.json")); err != nil {
		t.Fatal(err)
	}
	return newTestEnv(t)
}

// createTestSecret inserts a secret record and returns its ID.
func createTestSecret(t *testing.T, te *testEnv, name, status, scope, createdBy string, payload map[string]any) string {
	t.Helper()
	col, err := te.app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatalf("find secrets collection: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", name)
	rec.Set("status", status)
	rec.Set("scope", scope)
	rec.Set("created_by", createdBy)
	rec.Set("template_id", "single_value")
	rec.Set("version", 1)

	if payload != nil {
		enc, err := secrets.EncryptPayload(payload)
		if err != nil {
			t.Fatalf("encrypt payload: %v", err)
		}
		rec.Set("payload_encrypted", enc)
	}

	if err := te.app.Save(rec); err != nil {
		t.Fatalf("save secret: %v", err)
	}
	return rec.Id
}

// ─── Resolve tests ────────────────────────────────────────────────────────────

func TestResolve_NotFound(t *testing.T) {
	te := resolverTestEnv(t)
	defer te.cleanup()

	_, err := secrets.Resolve(te.app, "nonexistent-id", "user1")
	if err == nil {
		t.Fatal("expected error for nonexistent secret")
	}
	var re *secrets.ResolveError
	if !isResolveError(err, &re) {
		t.Fatalf("expected ResolveError, got %T: %v", err, err)
	}
	if re.SecretID != "nonexistent-id" {
		t.Errorf("expected SecretID=nonexistent-id, got %q", re.SecretID)
	}
}

func TestResolve_Revoked(t *testing.T) {
	te := resolverTestEnv(t)
	defer te.cleanup()

	id := createTestSecret(t, te, "revoked-secret", "revoked", "global", "user1",
		map[string]any{"value": "mysecret"})

	_, err := secrets.Resolve(te.app, id, "user1")
	if err == nil {
		t.Fatal("expected error for revoked secret")
	}
	var re *secrets.ResolveError
	if !isResolveError(err, &re) {
		t.Fatalf("expected ResolveError, got %T", err)
	}
	if re.Reason != "secret has been revoked" {
		t.Errorf("unexpected reason: %s", re.Reason)
	}
}

func TestResolve_NewFormat(t *testing.T) {
	te := resolverTestEnv(t)
	defer te.cleanup()

	payload := map[string]any{"password": "correct-horse-battery-staple"}
	id := createTestSecret(t, te, "new-format-secret", "active", "global", "user1", payload)

	result, err := secrets.Resolve(te.app, id, "user1")
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}
	if result["password"] != "correct-horse-battery-staple" {
		t.Errorf("expected password in payload, got %v", result)
	}
}

func TestResolve_NoPayload(t *testing.T) {
	te := resolverTestEnv(t)
	defer te.cleanup()

	// Create secret with no payload_encrypted and no value
	id := createTestSecret(t, te, "empty-secret", "active", "global", "user1", nil)

	_, err := secrets.Resolve(te.app, id, "user1")
	if err == nil {
		t.Fatal("expected error for secret with no payload")
	}
}

func TestResolve_RecordsLastUsed(t *testing.T) {
	te := resolverTestEnv(t)
	defer te.cleanup()

	id := createTestSecret(t, te, "track-secret", "active", "global", "user42",
		map[string]any{"value": "data"})

	_, err := secrets.Resolve(te.app, id, "user42")
	if err != nil {
		t.Fatalf("Resolve failed: %v", err)
	}

	// Give the goroutine time to write last_used_at
	time.Sleep(200 * time.Millisecond)

	rec, err := te.app.FindRecordById("secrets", id)
	if err != nil {
		t.Fatalf("re-fetch failed: %v", err)
	}
	if rec.GetString("last_used_by") != "user42" {
		t.Errorf("expected last_used_by=user42, got %q", rec.GetString("last_used_by"))
	}
	if rec.GetString("last_used_at") == "" {
		t.Error("expected last_used_at to be set")
	}
}

// ─── ValidateRef tests ────────────────────────────────────────────────────────

func TestValidateRef_NotFound(t *testing.T) {
	te := resolverTestEnv(t)
	defer te.cleanup()

	err := secrets.ValidateRef(te.app, "nonexistent", "user1")
	if err == nil {
		t.Fatal("expected error for nonexistent secret")
	}
}

func TestValidateRef_Revoked(t *testing.T) {
	te := resolverTestEnv(t)
	defer te.cleanup()

	id := createTestSecret(t, te, "revoked", "revoked", "global", "owner", nil)
	err := secrets.ValidateRef(te.app, id, "owner")
	if err == nil {
		t.Fatal("expected error for revoked secret")
	}
}

func TestValidateRef_PrivateOtherUser(t *testing.T) {
	te := resolverTestEnv(t)
	defer te.cleanup()

	id := createTestSecret(t, te, "private", "active", "user_private", "owner-id", nil)
	err := secrets.ValidateRef(te.app, id, "other-user-id")
	if err == nil {
		t.Fatal("expected access denied for user_private secret bound by non-owner")
	}
	var re *secrets.ResolveError
	if !isResolveError(err, &re) {
		t.Fatalf("expected ResolveError, got %T", err)
	}
	if re.Reason != "access denied: secret is private to another user" {
		t.Errorf("unexpected reason: %s", re.Reason)
	}
}

func TestValidateRef_PrivateOwnUser(t *testing.T) {
	te := resolverTestEnv(t)
	defer te.cleanup()

	id := createTestSecret(t, te, "private-own", "active", "user_private", "owner-id", nil)
	if err := secrets.ValidateRef(te.app, id, "owner-id"); err != nil {
		t.Errorf("expected allowed for owner, got: %v", err)
	}
}

func TestValidateRef_GlobalAnyUser(t *testing.T) {
	te := resolverTestEnv(t)
	defer te.cleanup()

	id := createTestSecret(t, te, "global-secret", "active", "global", "owner-id", nil)
	if err := secrets.ValidateRef(te.app, id, "any-other-user"); err != nil {
		t.Errorf("expected allowed for global scope, got: %v", err)
	}
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func isResolveError(err error, target **secrets.ResolveError) bool {
	if err == nil {
		return false
	}
	re, ok := err.(*secrets.ResolveError)
	if ok && target != nil {
		*target = re
	}
	return ok
}
