package secrets

import (
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// ─── Domain constants ─────────────────────────────────────────────────────────

const (
	StatusActive  = "active"
	StatusRevoked = "revoked"

	ScopeGlobal      = "global"
	ScopeUserPrivate = "user_private"

	CreatedSourceSystem = "system"
	CreatedSourceUser   = "user"

	// typeTunnelToken is a legacy guard value; old tunnel tokens may lack
	// created_source but always carried this type tag.
	typeTunnelToken = "tunnel_token"
)

// Secret is the aggregate root for the Security and Secret Management domain.
// It wraps a PocketBase record and exposes typed domain accessors, consolidating
// all domain rules about what a secret IS and what is ALLOWED on it.
//
// Callers should obtain a Secret via From(rec) and use its methods for all
// domain-level decisions instead of inspecting raw Record fields directly.
type Secret struct {
	rec *core.Record
}

// From wraps a PocketBase record as a Secret aggregate root.
func From(rec *core.Record) *Secret {
	return &Secret{rec: rec}
}

// Record returns the underlying PocketBase record for persistence operations.
func (s *Secret) Record() *core.Record { return s.rec }

// ─── Identity ────────────────────────────────────────────────────────────────

func (s *Secret) ID() string        { return s.rec.Id }
func (s *Secret) Name() string      { return s.rec.GetString("name") }
func (s *Secret) Scope() string     { return s.rec.GetString("scope") }
func (s *Secret) CreatedBy() string { return s.rec.GetString("created_by") }

// ─── State ───────────────────────────────────────────────────────────────────

func (s *Secret) Status() string     { return s.rec.GetString("status") }
func (s *Secret) AccessMode() string { return s.rec.GetString("access_mode") }
func (s *Secret) TemplateID() string { return s.rec.GetString("template_id") }
func (s *Secret) Version() int       { return s.rec.GetInt("version") }

// IsRevoked reports whether this secret has been revoked and can no longer be used.
func (s *Secret) IsRevoked() bool { return s.Status() == StatusRevoked }

// ─── Domain rules ────────────────────────────────────────────────────────────

// IsSystemManaged reports whether this secret was provisioned by the platform itself.
// System-managed secrets are read-only and cannot be updated or deleted by users.
func (s *Secret) IsSystemManaged() bool {
	if s.rec.GetString("created_source") == CreatedSourceSystem {
		return true
	}
	// Legacy guard: old tunnel tokens may not have created_source populated yet.
	return s.rec.GetString("type") == typeTunnelToken
}

// IsOwnedBy reports whether auth is permitted to manage this secret.
// Superusers may manage any secret; regular users only their own.
func (s *Secret) IsOwnedBy(auth *core.Record) bool {
	if auth == nil {
		return false
	}
	if auth.Collection().Name == core.CollectionNameSuperusers {
		return true
	}
	return s.rec.GetString("created_by") == auth.Id
}

// CanReveal reports whether the current access_mode permits payload reveal.
func (s *Secret) CanReveal() bool {
	return s.AccessMode() == AccessModeRevealOnce || s.AccessMode() == AccessModeRevealAllowed
}

// ─── Mutations ───────────────────────────────────────────────────────────────

// SetAccessMode updates the access_mode field on the underlying record.
func (s *Secret) SetAccessMode(mode string) {
	s.rec.Set("access_mode", mode)
}

// ─── Expiry ───────────────────────────────────────────────────────────────────

// ExpiresAt returns the expiry time of this secret, or zero if no expiry is set.
func (s *Secret) ExpiresAt() time.Time {
	raw := s.rec.GetString("expires_at")
	if raw == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}
	}
	return t
}

// IsExpired reports whether the secret has passed its expiry time.
func (s *Secret) IsExpired() bool {
	exp := s.ExpiresAt()
	return !exp.IsZero() && time.Now().UTC().After(exp)
}

// IsExpiringSoon reports whether the secret will expire within warnDays days.
// Returns false when warnDays is 0 or the secret has no expiry.
func (s *Secret) IsExpiringSoon(warnDays int) bool {
	if warnDays <= 0 {
		return false
	}
	exp := s.ExpiresAt()
	if exp.IsZero() {
		return false
	}
	return !s.IsExpired() && time.Now().UTC().Add(time.Duration(warnDays)*24*time.Hour).After(exp)
}
