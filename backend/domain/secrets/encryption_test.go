package secrets

import (
	"encoding/base64"
	"testing"
)

func setupTestKey(t *testing.T) {
	t.Helper()
	resetKeyForTest()
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	t.Setenv(EnvSecretKey, key)
	if err := LoadKeyFromEnv(); err != nil {
		t.Fatal(err)
	}
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	setupTestKey(t)

	payload := map[string]any{
		"username": "admin",
		"password": "s3cret",
	}

	enc, err := EncryptPayload(payload)
	if err != nil {
		t.Fatalf("encrypt failed: %v", err)
	}
	if enc == "" {
		t.Fatal("encrypted output is empty")
	}

	dec, err := DecryptPayload(enc)
	if err != nil {
		t.Fatalf("decrypt failed: %v", err)
	}
	if dec["username"] != "admin" {
		t.Errorf("expected username=admin, got %v", dec["username"])
	}
	if dec["password"] != "s3cret" {
		t.Errorf("expected password=s3cret, got %v", dec["password"])
	}
}

func TestEncryptPayload_EmptyMap(t *testing.T) {
	setupTestKey(t)

	enc, err := EncryptPayload(map[string]any{})
	if err != nil {
		t.Fatalf("encrypt empty payload failed: %v", err)
	}

	dec, err := DecryptPayload(enc)
	if err != nil {
		t.Fatalf("decrypt failed: %v", err)
	}
	if len(dec) != 0 {
		t.Errorf("expected empty map, got %v", dec)
	}
}

func TestDecryptPayload_InvalidJSON(t *testing.T) {
	setupTestKey(t)

	_, err := DecryptPayload("not json")
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestDecryptPayload_InvalidCiphertext(t *testing.T) {
	setupTestKey(t)

	// Use valid-length nonce (12 bytes base64) but garbage ciphertext
	// 12 zero bytes -> base64 = "AAAAAAAAAAAAAAAA"
	_, err := DecryptPayload(`{"nonce":"AAAAAAAAAAAAAAAA","ciphertext":"BBBBBBBBBBBB"}`)
	if err == nil {
		t.Fatal("expected error for invalid ciphertext")
	}
}

func TestEncryptPayload_NoKey(t *testing.T) {
	resetKeyForTest()

	_, err := EncryptPayload(map[string]any{"k": "v"})
	if err == nil {
		t.Fatal("expected error when key is not initialized")
	}
}

func TestDecryptPayload_NoKey(t *testing.T) {
	resetKeyForTest()

	_, err := DecryptPayload(`{"nonce":"AA==","ciphertext":"BB=="}`)
	if err == nil {
		t.Fatal("expected error when key is not initialized")
	}
}

func TestEncryptProducesDifferentCiphertexts(t *testing.T) {
	setupTestKey(t)

	payload := map[string]any{"value": "same"}
	enc1, err := EncryptPayload(payload)
	if err != nil {
		t.Fatal(err)
	}
	enc2, err := EncryptPayload(payload)
	if err != nil {
		t.Fatal(err)
	}

	if enc1 == enc2 {
		t.Error("two encryptions of the same payload should produce different ciphertext (random nonce)")
	}
}
