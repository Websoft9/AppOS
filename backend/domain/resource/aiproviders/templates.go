package aiproviders

import "github.com/websoft9/appos/backend/domain/resource/connectors"

func Templates() []Template {
	return connectors.TemplatesByKind(KindLLM)
}

func FindTemplate(id string) (Template, bool) {
	template, ok := connectors.FindTemplate(id)
	if !ok || template.Kind != KindLLM {
		return Template{}, false
	}
	return template, true
}
