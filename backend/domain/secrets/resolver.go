package secrets

import (
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/audit"
)

// SecretRefPrefix is the string prefix that marks a field value as a secret reference.
// Consuming modules detect this prefix and route through Resolve instead of using the
// value directly.
const SecretRefPrefix = "secretRef:"

// IsSecretRef reports whether v is a secretRef pointer string.
func IsSecretRef(v string) bool {
	return strings.HasPrefix(v, SecretRefPrefix)
}

// ExtractSecretID returns the UUID portion of a secretRef string.
// If v is not a valid secretRef, it returns ("", false).
func ExtractSecretID(v string) (string, bool) {
	if !IsSecretRef(v) {
		return "", false
	}
	id := strings.TrimPrefix(v, SecretRefPrefix)
	if id == "" {
		return "", false
	}
	return id, true
}

// ─── Error type ──────────────────────────────────────────────────────────────

// ResolveError is a structured error returned by Resolve and ValidateRef.
// Callers receive a machine-readable SecretID alongside the human-readable Reason.
type ResolveError struct {
	SecretID string
	Reason   string
	Cause    error
}

func (e *ResolveError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("secret %s: %s: %v", e.SecretID, e.Reason, e.Cause)
	}
	return fmt.Sprintf("secret %s: %s", e.SecretID, e.Reason)
}

func (e *ResolveError) Unwrap() error { return e.Cause }

// ─── ResolveResult ────────────────────────────────────────────────────────────

// ResolveResult carries the decrypted payload together with expiry metadata so
// callers (e.g. the HTTP resolve handler) can surface expiry status.
type ResolveResult struct {
	Payload   map[string]any
	ExpiresAt string // RFC 3339 or empty
	IsExpired bool
}

// ─── Resolve ─────────────────────────────────────────────────────────────────

// Resolve looks up secretID from the DB, validates it is active, decrypts the payload,
// records last_used_at / last_used_by, emits a "secret.use" audit event, and returns
// a ResolveResult.
//
// Format support:
//   - New format (Epic 19): `payload_encrypted` field — AES-256-GCM, base64 JSON blob.
//   - Legacy format (pre-Epic 19): `value` field — AES-256-GCM, hex-encoded, decrypted via
//     DecryptLegacyValue. Result is wrapped as {"value": <plaintext>}.
//
// The returned plaintext map MUST NOT be persisted by the caller (AC5).
// Resolve is synchronous and not cached in MVP.
func Resolve(app core.App, secretID, userID string) (*ResolveResult, error) {
	rec, err := app.FindRecordById("secrets", secretID)
	if err != nil {
		return nil, &ResolveError{SecretID: secretID, Reason: "secret not found", Cause: err}
	}

	s := From(rec)

	if s.IsRevoked() {
		return nil, &ResolveError{SecretID: secretID, Reason: "secret has been revoked"}
	}

	var payload map[string]any

	if enc := rec.GetString("payload_encrypted"); enc != "" {
		// New Epic-19 format: AES-256-GCM with nonce, base64 JSON blob.
		payload, err = DecryptPayload(enc)
		if err != nil {
			return nil, &ResolveError{SecretID: secretID, Reason: "decrypt failed", Cause: err}
		}
	} else if legacyVal := rec.GetString("value"); legacyVal != "" {
		// Legacy pre-Epic-19 format: hex AES-256-GCM via APPOS_ENCRYPTION_KEY.
		// TODO(story-19.4): remove this branch once all records are migrated to payload_encrypted.
		plain, decErr := DecryptLegacyValue(legacyVal)
		if decErr != nil {
			return nil, &ResolveError{SecretID: secretID, Reason: "legacy decrypt failed", Cause: decErr}
		}
		payload = map[string]any{"value": plain}
	} else {
		return nil, &ResolveError{SecretID: secretID, Reason: "secret has no payload"}
	}

	// Record usage synchronously with log-on-error (matches HTTP resolve route behavior).
	// Failure to update metadata never blocks the caller from receiving the payload.
	rec.Set("last_used_at", time.Now().UTC().Format(time.RFC3339))
	rec.Set("last_used_by", userID)
	if err := app.Save(rec); err != nil {
		log.Printf("secrets.Resolve: failed to update last_used fields for %s: %v", secretID, err)
	}
	audit.Write(app, audit.Entry{
		UserID:       userID,
		Action:       "secret.use",
		ResourceType: "secret",
		ResourceID:   secretID,
		ResourceName: s.Name(),
		Status:       audit.StatusSuccess,
	})

	return &ResolveResult{
		Payload:   payload,
		ExpiresAt: rec.GetString("expires_at"),
		IsExpired: s.IsExpired(),
	}, nil
}

// ─── ValidateRef ─────────────────────────────────────────────────────────────

// ValidateRef checks that secretID exists and that userID is permitted to bind it
// as a secretRef in another module's config field.
//
// Rules:
//   - Secret must exist and not be revoked.
//   - If scope == "user_private", only the owner (created_by == userID) may bind it.
//   - If scope == "global" (or empty/unset), any authenticated user may bind it.
func ValidateRef(app core.App, secretID, userID string) error {
	rec, err := app.FindRecordById("secrets", secretID)
	if err != nil {
		return &ResolveError{SecretID: secretID, Reason: "secret not found", Cause: err}
	}

	s := From(rec)

	if s.IsRevoked() {
		return &ResolveError{SecretID: secretID, Reason: "secret has been revoked"}
	}

	if s.Scope() == ScopeUserPrivate && s.CreatedBy() != userID {
		return &ResolveError{SecretID: secretID, Reason: "access denied: secret is private to another user"}
	}

	return nil
}

// ─── Convenience helpers ─────────────────────────────────────────────────────

// FirstStringFromPayload probes the payload map for a non-empty string under
// each of the given keys in order, returning the first match.
// Returns "" if none of the keys yield a non-empty string value.
func FirstStringFromPayload(payload map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := payload[k]; ok {
			if s, ok := v.(string); ok && s != "" {
				return s
			}
		}
	}
	return ""
}
