// Package resource owns the persistence-layer collection baselines for Resource namespace tables.
//
// Organization rule:
// - Initial migrations delegate full collection shape ownership here.
// - Later migrations remain append-only deltas and must not be folded back into history.
// - This package stays at the persistence-schema layer only; no domain/runtime logic belongs here.
package resource
