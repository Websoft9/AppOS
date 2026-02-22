package crypto_test

import (
	"os"
	"strings"
	"testing"

	"github.com/websoft9/appos/backend/internal/crypto"
)

func TestEncryptDecryptRoundTrip(t *testing.T) {
	crypto.ResetKey()
	defer crypto.ResetKey()

	tests := []string{
		"",
		"hello",
		"a longer secret value with special chars: !@#$%^&*()",
		"中文密码测试",
		strings.Repeat("x", 10000),
	}

	for _, plaintext := range tests {
		encrypted, err := crypto.Encrypt(plaintext)
		if err != nil {
			t.Fatalf("Encrypt(%q) error: %v", plaintext, err)
		}

		// Encrypted should be hex-encoded and non-empty (even for empty plaintext, nonce+tag exist)
		if encrypted == "" {
			t.Fatal("encrypted result is empty")
		}
		if encrypted == plaintext {
			t.Error("encrypted should differ from plaintext")
		}

		decrypted, err := crypto.Decrypt(encrypted)
		if err != nil {
			t.Fatalf("Decrypt error: %v", err)
		}
		if decrypted != plaintext {
			t.Errorf("roundtrip mismatch: got %q, want %q", decrypted, plaintext)
		}
	}
}

func TestEncryptProducesDifferentCiphertexts(t *testing.T) {
	crypto.ResetKey()
	defer crypto.ResetKey()

	a, _ := crypto.Encrypt("same-value")
	b, _ := crypto.Encrypt("same-value")

	if a == b {
		t.Error("two encryptions of the same value should produce different ciphertext (random nonce)")
	}
}

func TestDecryptInvalidHex(t *testing.T) {
	crypto.ResetKey()
	defer crypto.ResetKey()

	_, err := crypto.Decrypt("not-valid-hex!")
	if err == nil {
		t.Error("expected error for invalid hex input")
	}
}

func TestDecryptTooShort(t *testing.T) {
	crypto.ResetKey()
	defer crypto.ResetKey()

	_, err := crypto.Decrypt("aabb")
	if err == nil {
		t.Error("expected error for too-short ciphertext")
	}
}

func TestDecryptTamperedData(t *testing.T) {
	crypto.ResetKey()
	defer crypto.ResetKey()

	encrypted, _ := crypto.Encrypt("secret")
	// Flip a byte in the middle
	runes := []byte(encrypted)
	mid := len(runes) / 2
	if runes[mid] == 'a' {
		runes[mid] = 'b'
	} else {
		runes[mid] = 'a'
	}
	_, err := crypto.Decrypt(string(runes))
	if err == nil {
		t.Error("expected error for tampered ciphertext")
	}
}

func TestCustomKeyFromEnv(t *testing.T) {
	crypto.ResetKey()
	defer func() {
		os.Unsetenv(crypto.EnvKey)
		crypto.ResetKey()
	}()

	// Set a valid 32-byte hex key (64 hex chars)
	customKey := strings.Repeat("ab", 32) // 64 hex chars = 32 bytes
	os.Setenv(crypto.EnvKey, customKey)

	encrypted, err := crypto.Encrypt("test-with-custom-key")
	if err != nil {
		t.Fatalf("Encrypt error with custom key: %v", err)
	}

	decrypted, err := crypto.Decrypt(encrypted)
	if err != nil {
		t.Fatalf("Decrypt error with custom key: %v", err)
	}
	if decrypted != "test-with-custom-key" {
		t.Errorf("got %q, want %q", decrypted, "test-with-custom-key")
	}
}

func TestInvalidKeyLength(t *testing.T) {
	crypto.ResetKey()
	defer func() {
		os.Unsetenv(crypto.EnvKey)
		crypto.ResetKey()
	}()

	os.Setenv(crypto.EnvKey, "aabb") // only 2 bytes
	_, err := crypto.Encrypt("test")
	if err == nil {
		t.Error("expected error for invalid key length")
	}
}
