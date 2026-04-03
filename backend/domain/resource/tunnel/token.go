// Package tunnel provides a reverse-SSH tunnel entry point for local servers
// behind NAT. It is pure infrastructure with zero PocketBase coupling; all
// business-layer integration (token validation, status persistence, audit) is
// injected by the caller via the [TokenValidator] and [SessionHooks] interfaces.
package tunnel

import (
	"crypto/rand"
	"encoding/base32"
	"io"
)

// tokenEncoding is standard base32 (RFC 4648, A–Z 2–7) without padding.
// Every character is safe for use in an SSH username and in a URL path segment
// — no quoting or escaping required.
var tokenEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// Generate returns a cryptographically random, URL/SSH-safe token string.
//
// Entropy: 32 bytes (256 bits).
// Encoding: base32 no-padding → 52 characters, alphabet [A-Z2-7].
//
// Token validation is NOT performed here; that is the caller's responsibility
// (routes/tunnel.go looks the token up in the PocketBase secrets collection).
func Generate() string {
	b := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		// rand.Reader should never fail on any supported OS. If it does, the
		// process is in an unrecoverable state — panic is appropriate.
		panic("tunnel: failed to read random bytes: " + err.Error())
	}
	return tokenEncoding.EncodeToString(b)
}
