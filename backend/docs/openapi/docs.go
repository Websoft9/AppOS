// Package openapidocs embeds the AppOS OpenAPI specification so it can be
// served directly from the appos binary without depending on nginx or any
// external static file server.
package openapidocs

import _ "embed"

// APISpec is the raw merged OpenAPI 3.0 YAML for generated custom routes and native APIs.
//
//go:embed api.yaml
var APISpec []byte
