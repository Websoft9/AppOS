package secrets

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// ─── payloadFromAny ──────────────────────────────────────────────────────────

func TestPayloadFromAny_ValidMap(t *testing.T) {
	m, err := payloadFromAny(map[string]any{"key": "value"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if m["key"] != "value" {
		t.Errorf("expected value, got %v", m["key"])
	}
}

func TestPayloadFromAny_NilReturnsError(t *testing.T) {
	_, err := payloadFromAny(nil)
	if err == nil {
		t.Fatal("expected error for nil payload")
	}
}

func TestPayloadFromAny_JSONString(t *testing.T) {
	m, err := payloadFromAny(`{"a":"b"}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if m["a"] != "b" {
		t.Errorf("expected b, got %v", m["a"])
	}
}

func TestPayloadFromAny_Bytes(t *testing.T) {
	m, err := payloadFromAny([]byte(`{"x":1}`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if m["x"] != float64(1) {
		t.Errorf("expected 1, got %v", m["x"])
	}
}

func TestPayloadFromAny_InvalidString(t *testing.T) {
	_, err := payloadFromAny("not-json")
	if err == nil {
		t.Fatal("expected error for invalid JSON string")
	}
	if err.Error() != "payload must be a JSON object" {
		t.Errorf("expected consistent error message, got %q", err.Error())
	}
}

func TestPayloadFromAny_NonObjectType(t *testing.T) {
	// Integer gets json.Marshal'd to "42", then json.Unmarshal'd as non-object → error
	_, err := payloadFromAny(42)
	if err == nil {
		t.Fatal("expected error for non-object")
	}
	if err.Error() != "payload must be a JSON object" {
		t.Errorf("expected consistent error message, got %q", err.Error())
	}
}

// ─── RevealPayload sentinel errors ──────────────────────────────────────────

func TestRevealPayload_NotFound(t *testing.T) {
	app := newSecretsApp(t)
	defer app.Cleanup()
	setupTestKey(t)

	_, err := RevealPayload(app, "nonexistent-id", nil)
	if err == nil {
		t.Fatal("expected error for nonexistent secret")
	}
	if !errors.Is(err, ErrRevealNotFound) {
		t.Errorf("expected ErrRevealNotFound, got %v", err)
	}
}

func TestRevealPayload_Expired(t *testing.T) {
	app := newSecretsApp(t)
	defer app.Cleanup()
	setupTestKey(t)

	// Create a superuser for ownership check
	suCol, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatal(err)
	}
	su := core.NewRecord(suCol)
	su.Set("email", "reveal-test@test.com")
	su.SetPassword("1234567890")
	if err := app.Save(su); err != nil {
		t.Fatal(err)
	}

	col, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}

	rec := core.NewRecord(col)
	rec.Set("name", "expired-reveal-secret")
	rec.Set("scope", ScopeGlobal)
	rec.Set("access_mode", AccessModeRevealAllowed)
	rec.Set("status", StatusActive)
	rec.Set("created_source", CreatedSourceUser)
	rec.Set("created_by", su.Id)
	rec.Set("template_id", "single_value")
	rec.Set("version", 1)
	rec.Set("expires_at", "2020-01-01T00:00:00Z") // past

	enc, encErr := EncryptPayload(map[string]any{"value": "test"})
	if encErr != nil {
		t.Fatal(encErr)
	}
	rec.Set("payload_encrypted", enc)

	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}

	_, err = RevealPayload(app, rec.Id, su)
	if err == nil {
		t.Fatal("expected error for expired secret")
	}
	if !errors.Is(err, ErrRevealExpired) {
		t.Errorf("expected ErrRevealExpired, got %v", err)
	}
}

func TestRevealPayload_Revoked(t *testing.T) {
	app := newSecretsApp(t)
	defer app.Cleanup()
	setupTestKey(t)

	suCol, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatal(err)
	}
	su := core.NewRecord(suCol)
	su.Set("email", "revoke-test@test.com")
	su.SetPassword("1234567890")
	if err := app.Save(su); err != nil {
		t.Fatal(err)
	}

	col, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}

	rec := core.NewRecord(col)
	rec.Set("name", "revoked-reveal-secret")
	rec.Set("scope", ScopeGlobal)
	rec.Set("access_mode", AccessModeRevealAllowed)
	rec.Set("status", StatusRevoked)
	rec.Set("created_source", CreatedSourceUser)
	rec.Set("created_by", su.Id)
	rec.Set("template_id", "single_value")
	rec.Set("version", 1)

	enc, encErr := EncryptPayload(map[string]any{"value": "test"})
	if encErr != nil {
		t.Fatal(encErr)
	}
	rec.Set("payload_encrypted", enc)

	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}

	_, err = RevealPayload(app, rec.Id, su)
	if err == nil {
		t.Fatal("expected error for revoked secret")
	}
	if !errors.Is(err, ErrRevealRevoked) {
		t.Errorf("expected ErrRevealRevoked, got %v", err)
	}
}

// ─── Legacy encryption round-trip ────────────────────────────────────────────

func TestLegacyEncryptDecryptRoundTrip(t *testing.T) {
	resetLegacyKeyForTest()
	t.Setenv(envLegacyKey, devLegacyKey)

	plaintext := "my-secret-value"
	enc, err := encryptLegacyValue(plaintext)
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}
	if enc == "" {
		t.Fatal("encrypted output is empty")
	}

	dec, err := DecryptLegacyValue(enc)
	if err != nil {
		t.Fatalf("decrypt failed: %v", err)
	}
	if dec != plaintext {
		t.Errorf("expected %q, got %q", plaintext, dec)
	}
}

func TestReadSystemSingleValue_LegacyFallback(t *testing.T) {
	app := newSecretsApp(t)
	defer app.Cleanup()
	setupTestKey(t)
	resetLegacyKeyForTest()
	t.Setenv(envLegacyKey, devLegacyKey)

	col, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}

	// Create a record with only legacy `value` field (no payload_encrypted)
	legacyEnc, err := encryptLegacyValue("legacy-password")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", "legacy-secret")
	rec.Set("value", legacyEnc)
	rec.Set("version", 1)

	s := From(rec)
	val, err := ReadSystemSingleValue(s)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "legacy-password" {
		t.Errorf("expected legacy-password, got %q", val)
	}
}

func TestReadSystemSingleValue_PrefersPayloadEncrypted(t *testing.T) {
	app := newSecretsApp(t)
	defer app.Cleanup()
	setupTestKey(t)
	resetLegacyKeyForTest()
	t.Setenv(envLegacyKey, devLegacyKey)

	col, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}

	legacyEnc, err := encryptLegacyValue("old-value")
	if err != nil {
		t.Fatal(err)
	}
	newEnc, err := EncryptPayload(map[string]any{"value": "new-value"})
	if err != nil {
		t.Fatal(err)
	}

	rec := core.NewRecord(col)
	rec.Set("name", "both-formats")
	rec.Set("value", legacyEnc)
	rec.Set("payload_encrypted", newEnc)
	rec.Set("version", 1)

	s := From(rec)
	val, err := ReadSystemSingleValue(s)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "new-value" {
		t.Errorf("expected new-value (payload_encrypted preferred), got %q", val)
	}
}
