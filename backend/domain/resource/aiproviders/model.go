package aiproviders

import "github.com/websoft9/appos/backend/domain/resource/connectors"

const (
	KindLLM                  = connectors.KindLLM
	TemplateOpenAICompatible = connectors.TemplateGenericLLM
	TemplateGenericLLM       = TemplateOpenAICompatible
)

var EditableFields = connectors.EditableFields

type AIProvider = connectors.Connector
type Snapshot = connectors.Snapshot
type Template = connectors.Template
type TemplateField = connectors.TemplateField

func AllowedKinds() []string {
	return []string{KindLLM}
}

func IsAllowedKind(kind string) bool {
	return kind == KindLLM
}

func NewAIProvider() *AIProvider {
	return connectors.NewConnector()
}

func RestoreAIProvider(snapshot Snapshot) *AIProvider {
	return connectors.RestoreConnector(snapshot)
}

func DecodeConfig(raw any) map[string]any {
	return connectors.DecodeConfig(raw)
}
