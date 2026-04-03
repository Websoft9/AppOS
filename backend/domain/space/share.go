package space

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

// Share is a value object representing a newly-issued share token.
type Share struct {
	Token     string
	ExpiresAt time.Time
}

// NewShareToken generates a cryptographically random share token.
//
// Rules:
//   - minutes ≤ 0 → use defaultMin
//   - minutes > maxMin → error
//   - token is 32 random bytes encoded as hex
func NewShareToken(minutes, maxMin, defaultMin int) (Share, error) {
	if minutes <= 0 {
		minutes = defaultMin
	}
	if minutes > maxMin {
		return Share{}, fmt.Errorf("share duration cannot exceed %d minutes", maxMin)
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return Share{}, fmt.Errorf("failed to generate share token: %w", err)
	}

	return Share{
		Token:     hex.EncodeToString(tokenBytes),
		ExpiresAt: time.Now().UTC().Add(time.Duration(minutes) * time.Minute),
	}, nil
}
