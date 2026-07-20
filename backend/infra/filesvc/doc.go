// Package filesvc provides a local filesystem service boundary for backend
// domains that need path-scoped file and directory operations.
//
// Contract summary:
//   - every service instance is bound to one trusted base path and an explicit
//     allowlist of top-level roots
//   - callers pass slash-separated relative paths only; absolute paths,
//     traversal escapes, symlink escapes, and non-allowlisted roots are
//     rejected with ErrInvalidPath
//   - LocalService owns filesystem safety, root enforcement, and reusable file
//     operations; it does not own HTTP mapping, authorization, or product policy
//   - overwrite behavior is type-safe: file writes do not delete directories,
//     and directory copy or move operations do not delete files just to satisfy
//     a mismatched destination shape
//   - read-only services reject all mutating operations with ErrReadOnly
//   - streaming writes enforce byte limits through WriteReader and remove the
//     target file on copy-limit or sync failures so callers do not observe a
//     partial file as a successful write
//
// This package is intentionally infrastructure-scoped. Higher-level modules
// should adapt their own route shapes, metadata, and policy rules at their
// boundary instead of embedding domain semantics into filesvc itself.
package filesvc
