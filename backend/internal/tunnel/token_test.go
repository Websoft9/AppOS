package tunnel

import (
	"regexp"
	"testing"
)

// base32NoPad matches only characters in the RFC 4648 base32 alphabet (A–Z 2–7)
// with no padding characters.
var base32NoPadRe = regexp.MustCompile(`^[A-Z2-7]+$`)

func TestGenerate_Length(t *testing.T) {
	token := Generate()
	// 32 raw bytes → 52 base32-no-padding characters.
	if got, want := len(token), 52; got != want {
		t.Errorf("Generate() len = %d, want %d; token = %q", got, want, token)
	}
}

func TestGenerate_Alphabet(t *testing.T) {
	for i := 0; i < 100; i++ {
		token := Generate()
		if !base32NoPadRe.MatchString(token) {
			t.Errorf("Generate() produced non-base32 chars: %q", token)
		}
	}
}

func TestGenerate_Uniqueness(t *testing.T) {
	// Generate a large batch and verify no duplicates (collision probability ≈0).
	const n = 1000
	seen := make(map[string]bool, n)
	for i := 0; i < n; i++ {
		tok := Generate()
		if seen[tok] {
			t.Fatalf("Generate() produced duplicate token after %d attempts: %q", i, tok)
		}
		seen[tok] = true
	}
}
