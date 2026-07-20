package secrets

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const EnvSecretKey = "APPOS_SECRET_KEY" // #nosec G101 -- environment variable name, not an embedded secret

var (
	keyMu  sync.RWMutex
	keyRaw []byte
)

// LoadKeyFromEnv reads the AES-256 secret key from the APPOS_SECRET_KEY
// environment variable (base64-encoded 32-byte value) and stores it in memory.
// Must be called at startup before any encrypt/decrypt operations.
func LoadKeyFromEnv() error {
	raw := os.Getenv(EnvSecretKey)
	return loadKeyString(raw)
}

func EnsureRuntimeKey(dataDir string) (warning string, generated bool, err error) {
	resolvedDir := strings.TrimSpace(dataDir)
	if resolvedDir == "" {
		return "", false, fmt.Errorf("dataDir is required")
	}
	if err := os.MkdirAll(resolvedDir, 0o755); err != nil {
		return "", false, fmt.Errorf("ensure data dir: %w", err)
	}
	keyPath := filepath.Join(resolvedDir, ".appos_secret_key")
	if persisted, readErr := os.ReadFile(filepath.Clean(keyPath)); readErr == nil {
		persistedValue := strings.TrimSpace(string(persisted))
		if persistedValue == "" {
			return "", false, fmt.Errorf("persisted secret key file %s is empty", keyPath)
		}
		if err := loadKeyString(persistedValue); err != nil {
			return "", false, fmt.Errorf("invalid persisted secret key %s: %w", keyPath, err)
		}
		provided := strings.TrimSpace(os.Getenv(EnvSecretKey))
		if provided != "" && provided != persistedValue {
			warning = "ignoring provided APPOS_SECRET_KEY because a persisted key already exists"
		}
		if err := os.Setenv(EnvSecretKey, persistedValue); err != nil {
			return "", false, fmt.Errorf("set persisted secret key env: %w", err)
		}
		return warning, false, nil
	} else if !os.IsNotExist(readErr) {
		return "", false, fmt.Errorf("read persisted secret key %s: %w", keyPath, readErr)
	}

	provided := strings.TrimSpace(os.Getenv(EnvSecretKey))
	if provided != "" {
		if err := loadKeyString(provided); err != nil {
			return "", false, err
		}
		if err := os.WriteFile(filepath.Clean(keyPath), []byte(provided), 0o600); err != nil {
			return "", false, fmt.Errorf("persist provided secret key: %w", err)
		}
		if err := os.Setenv(EnvSecretKey, provided); err != nil {
			return "", false, fmt.Errorf("set provided secret key env: %w", err)
		}
		return "", false, nil
	}

	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", false, fmt.Errorf("generate runtime secret key: %w", err)
	}
	encoded := base64.StdEncoding.EncodeToString(buf)
	if err := os.WriteFile(filepath.Clean(keyPath), []byte(encoded), 0o600); err != nil {
		return "", false, fmt.Errorf("persist generated secret key: %w", err)
	}
	if err := os.Setenv(EnvSecretKey, encoded); err != nil {
		return "", false, fmt.Errorf("set generated secret key env: %w", err)
	}
	if err := loadKeyString(encoded); err != nil {
		return "", false, err
	}
	return "", true, nil
}

func loadKeyString(raw string) error {
	if raw == "" {
		return fmt.Errorf("%s is required", EnvSecretKey)
	}
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return fmt.Errorf("%s must be valid base64: %w", EnvSecretKey, err)
	}
	if len(decoded) != 32 {
		return fmt.Errorf("%s must decode to 32 bytes, got %d", EnvSecretKey, len(decoded))
	}

	keyMu.Lock()
	defer keyMu.Unlock()
	keyRaw = decoded
	return nil
}

func currentKey() ([]byte, error) {
	keyMu.RLock()
	defer keyMu.RUnlock()
	if len(keyRaw) != 32 {
		return nil, fmt.Errorf("secret key is not initialized")
	}
	out := make([]byte, len(keyRaw))
	copy(out, keyRaw)
	return out, nil
}

func resetKeyForTest() {
	keyMu.Lock()
	defer keyMu.Unlock()
	keyRaw = nil
}
