package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"sync"
)

// Legacy encryption support for pre-Epic-19 secrets that used the `value` field
// with hex-encoded AES-256-GCM (key from APPOS_ENCRYPTION_KEY).
// TODO(story-19.4): remove this file once all legacy records are migrated.

const envLegacyKey = "APPOS_ENCRYPTION_KEY"

const devLegacyKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

var (
	legacyKeyOnce sync.Once
	legacyKeyRaw  []byte
	legacyKeyErr  error
)

func legacyKey() ([]byte, error) {
	legacyKeyOnce.Do(func() {
		hexKey := os.Getenv(envLegacyKey)
		if hexKey == "" {
			log.Printf("WARNING: %s is not set — using insecure dev-only key. Do NOT use this in production.", envLegacyKey)
			hexKey = devLegacyKey
		}
		legacyKeyRaw, legacyKeyErr = hex.DecodeString(hexKey)
		if legacyKeyErr != nil {
			legacyKeyErr = fmt.Errorf("%s must be valid hex: %w", envLegacyKey, legacyKeyErr)
			return
		}
		if len(legacyKeyRaw) != 32 {
			legacyKeyErr = fmt.Errorf("%s must decode to 32 bytes, got %d", envLegacyKey, len(legacyKeyRaw))
		}
	})
	return legacyKeyRaw, legacyKeyErr
}

// DecryptLegacyValue decrypts a hex-encoded AES-256-GCM value produced by the
// pre-Epic-19 infra/crypto package.  Format: hex(nonce || ciphertext || tag).
func DecryptLegacyValue(ciphertextHex string) (string, error) {
	k, err := legacyKey()
	if err != nil {
		return "", err
	}

	data, err := hex.DecodeString(ciphertextHex)
	if err != nil {
		return "", fmt.Errorf("invalid hex ciphertext: %w", err)
	}

	block, err := aes.NewCipher(k)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}

	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("decryption failed: %w", err)
	}
	return string(plain), nil
}

// EncryptLegacyValue encrypts plaintext using the legacy hex-encoded AES-256-GCM
// format stored in the `value` field by pre-Epic-19 system-managed secrets.
func EncryptLegacyValue(plaintext string) (string, error) {
	k, err := legacyKey()
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(k)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	sealed := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	out := append(nonce, sealed...)
	return hex.EncodeToString(out), nil
}

func resetLegacyKeyForTest() {
	legacyKeyOnce = sync.Once{}
	legacyKeyRaw = nil
	legacyKeyErr = nil
}
