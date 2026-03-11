package secrets

import (
	"encoding/base64"
	"fmt"
	"os"
	"sync"
)

const EnvSecretKey = "APPOS_SECRET_KEY"

var (
	keyMu  sync.RWMutex
	keyRaw []byte
)

func LoadKeyFromEnv() error {
	raw := os.Getenv(EnvSecretKey)
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
