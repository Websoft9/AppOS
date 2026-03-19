package config

import _ "embed"

// EmbeddedComponentsRegistry is the source-controlled components registry
// compiled into the appos binary.
//
//go:embed components.yaml
var EmbeddedComponentsRegistry []byte