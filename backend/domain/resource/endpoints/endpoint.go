// Package endpoints implements the Endpoint resource domain.
//
// An Endpoint is a reusable external service target such as a REST API,
// outbound webhook destination, or MCP server. It carries connection metadata,
// auth mode, and an optional secret reference, but does not itself model
// provider-specific workflows.
package endpoints

import "github.com/pocketbase/pocketbase/core"

const Collection = "endpoints"

var EditableFields = []string{"name", "type", "url", "auth_type", "credential", "extra", "description"}

// Endpoint is the aggregate root for the Endpoint resource domain.
// It wraps a PocketBase record and exposes typed domain accessors.
type Endpoint struct {
	rec *core.Record
}

func From(rec *core.Record) *Endpoint {
	return &Endpoint{rec: rec}
}

func (e *Endpoint) Record() *core.Record { return e.rec }
func (e *Endpoint) ID() string           { return e.rec.Id }
func (e *Endpoint) Name() string         { return e.rec.GetString("name") }
func (e *Endpoint) Type() string         { return e.rec.GetString("type") }
func (e *Endpoint) URL() string          { return e.rec.GetString("url") }
func (e *Endpoint) AuthType() string     { return e.rec.GetString("auth_type") }
func (e *Endpoint) CredentialID() string { return e.rec.GetString("credential") }
func (e *Endpoint) Description() string  { return e.rec.GetString("description") }

func (e *Endpoint) Config() map[string]any {
	raw := e.rec.Get("extra")
	if config, ok := raw.(map[string]any); ok {
		clone := make(map[string]any, len(config))
		for key, value := range config {
			clone[key] = value
		}
		return clone
	}
	return map[string]any{}
}