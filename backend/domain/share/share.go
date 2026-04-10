package share

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
)

var (
	ErrNoExpiry        = errors.New("share link has no expiry set")
	ErrRevoked         = errors.New("share link has been revoked")
	ErrExpired         = errors.New("share link has expired")
	ErrDurationTooLong = errors.New("share duration too long")
	ErrTokenGeneration = errors.New("share token generation failed")
)

// Token is an immutable value object representing a newly-issued share token.
type Token struct {
	value     string
	expiresAt time.Time
}

// Value returns the generated share token string.
func (t Token) Value() string { return t.value }

// ExpiresAt returns the UTC time at which the share token expires.
func (t Token) ExpiresAt() time.Time { return t.expiresAt }

// RestoreToken reconstructs a Token from persisted values.
func RestoreToken(value string, expiresAt time.Time) Token {
	return Token{value: value, expiresAt: expiresAt}
}

// NewToken generates a cryptographically random share token.
//
// Rules:
//   - minutes <= 0 -> use defaultMin
//   - minutes > maxMin -> error
//   - token is 32 random bytes encoded as hex
func NewToken(minutes, maxMin, defaultMin int) (Token, error) {
	if minutes <= 0 {
		minutes = defaultMin
	}
	if minutes > maxMin {
		return Token{}, fmt.Errorf("%w: share duration cannot exceed %d minutes", ErrDurationTooLong, maxMin)
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return Token{}, fmt.Errorf("%w: %v", ErrTokenGeneration, err)
	}

	return Token{
		value:     hex.EncodeToString(tokenBytes),
		expiresAt: time.Now().UTC().Add(time.Duration(minutes) * time.Minute),
	}, nil
}

// ParseExpiry parses a persisted share expiry timestamp.
func ParseExpiry(raw string) (time.Time, error) {
	if raw == "" {
		return time.Time{}, ErrNoExpiry
	}
	return time.Parse(time.RFC3339, raw)
}

// ValidateActive validates whether a share token is active at the provided time.
func ValidateActive(token, expiryRaw string, now time.Time) error {
	if token == "" {
		return ErrRevoked
	}
	expiresAt, err := ParseExpiry(expiryRaw)
	if err != nil {
		return ErrNoExpiry
	}
	if now.UTC().After(expiresAt) {
		return ErrExpired
	}
	return nil
}

// MessageForError returns the canonical user-facing message for a typed share error.
func MessageForError(err error) string {
	switch {
	case errors.Is(err, ErrRevoked):
		return "share link has been revoked"
	case errors.Is(err, ErrNoExpiry):
		return "share link has no expiry set"
	case errors.Is(err, ErrExpired):
		return "share link has expired"
	case errors.Is(err, ErrDurationTooLong):
		return err.Error()
	default:
		return "invalid share request"
	}
}
