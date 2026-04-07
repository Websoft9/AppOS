package connectors

import (
	"strings"

	"github.com/websoft9/appos/backend/domain/secrets"
)


// SpecFromLLMProvider maps the current provider-style LLM shape into canonical connector semantics.
func SpecFromLLMProvider(name, endpoint, apiKey string) Spec {
	template := ResolveLLMTemplate(name)
	authScheme := AuthSchemeNone
	credentialID := ""
	if strings.TrimSpace(apiKey) != "" {
		authScheme = template.DefaultAuth
		if authScheme == "" {
			authScheme = AuthSchemeAPIKey
		}
		if id, ok := secrets.ExtractSecretID(apiKey); ok {
			credentialID = id
		}
	}
	if authScheme == "" {
		authScheme = AuthSchemeNone
	}
	resolvedEndpoint := endpoint
	if strings.TrimSpace(resolvedEndpoint) == "" {
		resolvedEndpoint = template.DefaultEndpoint
	}

	return Spec{
		Name:         name,
		Kind:         KindLLM,
		TemplateID:   template.ID,
		Endpoint:     resolvedEndpoint,
		AuthScheme:   authScheme,
		CredentialID: credentialID,
		Config:       map[string]any{},
	}
}