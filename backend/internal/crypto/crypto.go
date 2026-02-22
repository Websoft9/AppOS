// Package crypto provides AES-256-GCM encryption/decryption for secret values.
//
// Used by both Resource Store secrets and App-scoped credentials (Epic 8).
// The encryption key is sourced from the APPOS_ENCRYPTION_KEY environment variable
// (32-byte hex string). If not set, a deterministic dev-only key is used.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"
)

const (
	// EnvKey is the environment variable name for the 256-bit encryption key (hex-encoded).
	EnvKey = "APPOS_ENCRYPTION_KEY"

	// devKey is a deterministic 256-bit key used ONLY when APPOS_ENCRYPTION_KEY is unset.
	// ⚠️ NOT suitable for production.
	devKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
)

var (
	keyOnce sync.Once
	keyBytes []byte

	ErrCiphertextTooShort = errors.New("crypto: ciphertext too short")
)

// key returns the 32-byte AES key, resolved once on first call.
func key() ([]byte, error) {
	var resolveErr error
	keyOnce.Do(func() {
		hexKey := os.Getenv(EnvKey)
		if hexKey == "" {
			hexKey = devKey
		}
		keyBytes, resolveErr = hex.DecodeString(hexKey)
		if resolveErr != nil {
			resolveErr = fmt.Errorf("crypto: invalid hex key in %s: %w", EnvKey, resolveErr)
			return
		}
		if len(keyBytes) != 32 {
			resolveErr = fmt.Errorf("crypto: key must be 32 bytes (64 hex chars), got %d bytes", len(keyBytes))
		}
	})
	return keyBytes, resolveErr
}

// Encrypt encrypts plaintext using AES-256-GCM and returns a hex-encoded ciphertext
// (nonce || ciphertext || tag).
func Encrypt(plaintext string) (string, error) {
	k, err := key()
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(k)
	if err != nil {
		return "", fmt.Errorf("crypto: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("crypto: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("crypto: %w", err)
	}

	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return hex.EncodeToString(sealed), nil
}

// Decrypt decrypts hex-encoded AES-256-GCM ciphertext and returns the plaintext.
func Decrypt(ciphertextHex string) (string, error) {
	k, err := key()
	if err != nil {
		return "", err
	}

	data, err := hex.DecodeString(ciphertextHex)
	if err != nil {
		return "", fmt.Errorf("crypto: invalid hex ciphertext: %w", err)
	}

	block, err := aes.NewCipher(k)
	if err != nil {
		return "", fmt.Errorf("crypto: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("crypto: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", ErrCiphertextTooShort
	}

	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("crypto: decryption failed: %w", err)
	}

	return string(plaintext), nil
}

// ResetKey is for testing only — resets the cached key so it can be re-resolved.
func ResetKey() {
	keyOnce = sync.Once{}
	keyBytes = nil
}
