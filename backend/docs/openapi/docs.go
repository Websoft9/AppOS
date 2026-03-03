// Package openapidocs embeds the AppOS OpenAPI specification so it can be
// served directly from the appos binary without depending on nginx or any
// external static file server.
package openapidocs

import _ "embed"

// APISpec is the raw merged OpenAPI 3.0 YAML (Ext + Native).
//
//go:embed api.yaml
var APISpec []byte
