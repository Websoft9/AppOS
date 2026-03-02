// Package openapidocs embeds the AppOS OpenAPI specification so it can be
// served directly from the appos binary without depending on nginx or any
// external static file server.
package openapidocs

import _ "embed"

// ExtAPISpec is the raw OpenAPI 3.0 YAML for all /api/ext/* routes.
//
//go:embed ext-api.yaml
var ExtAPISpec []byte
