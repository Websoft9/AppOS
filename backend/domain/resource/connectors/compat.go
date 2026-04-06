package connectors

import (
	"strings"

	"github.com/websoft9/appos/backend/domain/resource/endpoints"
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

// SpecFromEndpoint maps the current endpoint resource shape into canonical connector semantics.
func SpecFromEndpoint(endpoint *endpoints.Endpoint) Spec {
	return Spec{
		Name:         endpoint.Name(),
		Kind:         endpointKind(endpoint.Type()),
		TemplateID:   endpointTemplateID(endpoint.Type()),
		Endpoint:     endpoint.URL(),
		AuthScheme:   normalizeAuthScheme(endpoint.AuthType()),
		CredentialID: endpoint.CredentialID(),
		Config:       endpoint.Config(),
		Description:  endpoint.Description(),
	}
}

func endpointKind(endpointType string) string {
	switch strings.TrimSpace(strings.ToLower(endpointType)) {
	case "webhook":
		return KindWebhook
	case "mcp":
		return KindMCP
	default:
		return KindRESTAPI
	}
}

func endpointTemplateID(endpointType string) string {
	switch strings.TrimSpace(strings.ToLower(endpointType)) {
	case "webhook":
		return "generic-webhook"
	case "mcp":
		return "generic-mcp"
	default:
		return TemplateGenericREST
	}
}

func normalizeAuthScheme(raw string) string {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case AuthSchemeAPIKey:
		return AuthSchemeAPIKey
	case AuthSchemeBearer:
		return AuthSchemeBearer
	case AuthSchemeBasic:
		return AuthSchemeBasic
	default:
		return AuthSchemeNone
	}
}