// Package groups implements the Groups domain — cross-type resource organisation.
//
// A Group is a named label that can be assigned to any supported object type
// (server, secret, database, etc.) for visual organisation. Groups do not
// convey permissions or tenant boundaries.
//
// Domain boundary: this package must not import backend/infra, backend/platform,
// or any concrete framework/IO package. Its only allowed dependencies are other
// domain packages and domain-owned interfaces.
package groups

import "github.com/pocketbase/pocketbase/core"

// ─── Collection names ─────────────────────────────────────────────────────────

const (
	Collection      = "groups"
	ItemsCollection = "group_items"
)

// ─── Group aggregate ──────────────────────────────────────────────────────────

// Group is the aggregate root for the Groups domain.
// It wraps a PocketBase record and exposes typed domain accessors.
// Callers should obtain a Group via From and use its methods for all
// domain-level decisions instead of inspecting raw Record fields directly.
type Group struct {
	rec *core.Record
}

// From wraps a PocketBase record as a Group aggregate root.
func From(rec *core.Record) *Group {
	return &Group{rec: rec}
}

// Record returns the underlying PocketBase record for persistence operations.
func (g *Group) Record() *core.Record { return g.rec }

// ─── Identity and state accessors ────────────────────────────────────────────

func (g *Group) ID() string          { return g.rec.Id }
func (g *Group) Name() string        { return g.rec.GetString("name") }
func (g *Group) Description() string { return g.rec.GetString("description") }
func (g *Group) CreatedBy() string   { return g.rec.GetString("created_by") }

// IsDefault reports whether this is the system-seeded default group.
// Default groups must not be deleted; this invariant must be enforced by
// route handlers before issuing any delete operation on a Group record.
func (g *Group) IsDefault() bool { return g.rec.GetBool("is_default") }
