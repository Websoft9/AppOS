package secrets

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureRuntimeKeyUsesPersistedFile(t *testing.T) {
	resetKeyForTest()
	t.Cleanup(resetKeyForTest)
	dir := t.TempDir()
	persisted := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	if err := os.WriteFile(filepath.Join(dir, ".appos_secret_key"), []byte(persisted), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(EnvSecretKey, base64.StdEncoding.EncodeToString([]byte("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")))
	warning, generated, err := EnsureRuntimeKey(dir)
	if err != nil {
		t.Fatalf("ensure runtime key: %v", err)
	}
	if generated {
		t.Fatal("expected persisted key to avoid generation")
	}
	if !strings.Contains(warning, "ignoring provided") {
		t.Fatalf("expected warning about provided key, got %q", warning)
	}
	if got := os.Getenv(EnvSecretKey); got != persisted {
		t.Fatalf("expected env to use persisted key, got %q", got)
	}
	if err := LoadKeyFromEnv(); err != nil {
		t.Fatalf("load secret from env: %v", err)
	}
}

func TestEnsureRuntimeKeyPersistsProvidedValue(t *testing.T) {
	resetKeyForTest()
	t.Cleanup(resetKeyForTest)
	dir := t.TempDir()
	provided := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	t.Setenv(EnvSecretKey, provided)
	warning, generated, err := EnsureRuntimeKey(dir)
	if err != nil {
		t.Fatalf("ensure runtime key: %v", err)
	}
	if warning != "" {
		t.Fatalf("expected no warning, got %q", warning)
	}
	if generated {
		t.Fatal("expected provided key to be persisted without generation")
	}
	stored, err := os.ReadFile(filepath.Join(dir, ".appos_secret_key"))
	if err != nil {
		t.Fatalf("read stored key: %v", err)
	}
	if string(stored) != provided {
		t.Fatalf("expected stored key %q, got %q", provided, string(stored))
	}
}

func TestEnsureRuntimeKeyGeneratesWhenMissing(t *testing.T) {
	resetKeyForTest()
	t.Cleanup(resetKeyForTest)
	dir := t.TempDir()
	t.Setenv(EnvSecretKey, "")
	warning, generated, err := EnsureRuntimeKey(dir)
	if err != nil {
		t.Fatalf("ensure runtime key: %v", err)
	}
	if warning != "" {
		t.Fatalf("expected no warning, got %q", warning)
	}
	if !generated {
		t.Fatal("expected generation when no key exists")
	}
	stored, err := os.ReadFile(filepath.Join(dir, ".appos_secret_key"))
	if err != nil {
		t.Fatalf("read generated key: %v", err)
	}
	decoded, err := base64.StdEncoding.DecodeString(string(stored))
	if err != nil {
		t.Fatalf("generated key should be base64: %v", err)
	}
	if len(decoded) != 32 {
		t.Fatalf("expected 32-byte generated key, got %d", len(decoded))
	}
	if got := os.Getenv(EnvSecretKey); got != string(stored) {
		t.Fatalf("expected env to match generated key, got %q", got)
	}
	if err := LoadKeyFromEnv(); err != nil {
		t.Fatalf("load generated key from env: %v", err)
	}
}
