package secrets

import (
	"encoding/base64"
	"testing"
)

func TestLoadKeyFromEnv_Missing(t *testing.T) {
	resetKeyForTest()
	t.Setenv(EnvSecretKey, "")
	if err := LoadKeyFromEnv(); err == nil {
		t.Fatal("expected error for missing key")
	}
}

func TestLoadKeyFromEnv_InvalidBase64(t *testing.T) {
	resetKeyForTest()
	t.Setenv(EnvSecretKey, "not-valid-base64!!!")
	if err := LoadKeyFromEnv(); err == nil {
		t.Fatal("expected error for invalid base64")
	}
}

func TestLoadKeyFromEnv_WrongLength(t *testing.T) {
	resetKeyForTest()
	t.Setenv(EnvSecretKey, base64.StdEncoding.EncodeToString([]byte("tooshort")))
	if err := LoadKeyFromEnv(); err == nil {
		t.Fatal("expected error for wrong key length")
	}
}

func TestLoadKeyFromEnv_Valid(t *testing.T) {
	resetKeyForTest()
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	t.Setenv(EnvSecretKey, key)
	if err := LoadKeyFromEnv(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	k, err := currentKey()
	if err != nil {
		t.Fatal(err)
	}
	if len(k) != 32 {
		t.Fatalf("expected 32-byte key, got %d", len(k))
	}
}

func TestCurrentKey_Uninitialized(t *testing.T) {
	resetKeyForTest()
	_, err := currentKey()
	if err == nil {
		t.Fatal("expected error for uninitialized key")
	}
}
