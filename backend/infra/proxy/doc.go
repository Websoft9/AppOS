// Package proxy defines the shared registry and runtime primitives for
// AppOS proxy-capable outbound egress.
//
// The first slice in this package establishes a code-level registry of known
// network surfaces. Runtime enrollment and client/env wiring build on top of
// this registry so proxy usage stays explicit, validated, and centrally owned.
package proxy