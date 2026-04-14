package secrets

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// applyDefaultAccessMode sets access_mode on record to the policy default when
// no access_mode has been explicitly provided by the caller.
func applyDefaultAccessMode(app core.App, record *core.Record) {
	if app == nil || record == nil || strings.TrimSpace(record.GetString("access_mode")) != "" {
		return
	}

	policy := GetPolicy(app)
	record.Set("access_mode", policy.DefaultAccessMode)
}

// applyExpiryPolicy sets expires_at on record according to the policy MaxAgeDays.
// When MaxAgeDays is 0 the field is left empty (no expiry).
// Does nothing when app or record is nil, or when an explicit expires_at is already set.
func applyExpiryPolicy(app core.App, record *core.Record) {
	if app == nil || record == nil {
		return
	}
	if strings.TrimSpace(record.GetString("expires_at")) != "" {
		return // caller provided an explicit expiry — do not overwrite
	}
	policy := GetPolicy(app)
	if policy.MaxAgeDays <= 0 {
		return
	}
	expiresAt := time.Now().UTC().Add(time.Duration(policy.MaxAgeDays) * 24 * time.Hour)
	record.Set("expires_at", expiresAt.Format(time.RFC3339))
}

// payloadFromAny coerces any PocketBase field value to map[string]any.
// PocketBase JSONField values arrive as types.JsonRaw ([]byte); this function
// also handles direct map, string, and unknown types via JSON round-trip.
func payloadFromAny(v any) (map[string]any, error) {
	if v == nil {
		return nil, fmt.Errorf("payload is required")
	}
	if m, ok := v.(map[string]any); ok {
		return m, nil
	}
	var raw []byte
	switch t := v.(type) {
	case []byte:
		raw = t
	case string:
		raw = []byte(t)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return nil, fmt.Errorf("payload must be a JSON object")
		}
		raw = b
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("payload must be a JSON object")
	}
	return m, nil
}

// ─── RevealPayload ────────────────────────────────────────────────────────────

// RevealResult carries the decrypted payload together with record metadata so
// the caller (HTTP handler) can write audit entries with full context.
type RevealResult struct {
	Payload    map[string]any
	RecordID   string
	RecordName string
}

// Sentinel errors returned by RevealPayload for structured route-layer mapping.
var (
	ErrRevealDisabled   = errors.New("reveal_disabled")
	ErrRevealNotFound   = errors.New("not_found")
	ErrRevealForbidden  = errors.New("forbidden")
	ErrRevealRevoked    = errors.New("revoked")
	ErrRevealExpired    = errors.New("expired")
	ErrRevealNotAllowed = errors.New("reveal_not_allowed")
)

// RevealPayload performs the full reveal operation atomically:
//  1. Checks the platform-wide reveal policy.
//  2. Validates ownership, revocation, and access_mode.
//  3. Decrypts the payload.
//  4. Downgrades reveal_once → use_only inside the same transaction.
//
// It does NOT write audit — the caller is responsible for that because
// audit entries may include HTTP-layer context (IP, User-Agent).
func RevealPayload(app core.App, secretID string, auth *core.Record) (*RevealResult, error) {
	var result RevealResult

	txErr := app.RunInTransaction(func(txApp core.App) error {
		policy := GetPolicy(txApp)
		if policy.RevealDisabled {
			return ErrRevealDisabled
		}

		rec, err := txApp.FindRecordById("secrets", secretID)
		if err != nil {
			return ErrRevealNotFound
		}
		s := From(rec)

		if !s.IsOwnedBy(auth) {
			return ErrRevealForbidden
		}
		if s.IsRevoked() {
			return ErrRevealRevoked
		}
		if s.IsExpired() {
			return ErrRevealExpired
		}
		if !s.CanReveal() {
			return ErrRevealNotAllowed
		}

		payload, err := DecryptPayload(rec.GetString("payload_encrypted"))
		if err != nil {
			return fmt.Errorf("decrypt_failed: %w", err)
		}

		if s.AccessMode() == AccessModeRevealOnce {
			s.SetAccessMode(AccessModeUseOnly)
			if err := txApp.Save(s.Record()); err != nil {
				return fmt.Errorf("downgrade_failed: %w", err)
			}
		}

		result.Payload = payload
		result.RecordID = rec.Id
		result.RecordName = rec.GetString("name")
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}

	return &result, nil
}

// actorID returns the ID of the authenticated user, or "system" for background operations.
func actorID(auth *core.Record) string {
	if auth == nil {
		return CreatedSourceSystem
	}
	return auth.Id
}

// actorEmail returns the email of the authenticated user, or empty string for background operations.
func actorEmail(auth *core.Record) string {
	if auth == nil {
		return ""
	}
	return auth.GetString("email")
}
