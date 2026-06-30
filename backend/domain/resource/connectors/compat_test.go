package connectors

import (
	"testing"
)

func TestSpecFromLLMProvider(t *testing.T) {
	spec := SpecFromLLMProvider("OpenAI", "https://api.openai.com/v1", "secretRef:sec_123")

	if spec.Kind != KindLLM {
		t.Fatalf("expected kind %q, got %q", KindLLM, spec.Kind)
	}
	if spec.TemplateID != "openai" {
		t.Fatalf("expected template_id %q, got %q", "openai", spec.TemplateID)
	}
	if spec.AuthScheme != AuthSchemeAPIKey {
		t.Fatalf("expected auth_scheme %q, got %q", AuthSchemeAPIKey, spec.AuthScheme)
	}
	if spec.CredentialID != "sec_123" {
		t.Fatalf("expected credential id sec_123, got %q", spec.CredentialID)
	}
}

func TestResolveLLMTemplate(t *testing.T) {
	template := ResolveLLMTemplate("Azure OpenAI")
	if template.ID != "azure-openai" {
		t.Fatalf("expected Azure OpenAI template, got %q", template.ID)
	}

	custom := ResolveLLMTemplate("Unknown Vendor")
	if custom.ID != TemplateGenericLLM {
		t.Fatalf("expected fallback template %q, got %q", TemplateGenericLLM, custom.ID)
	}
	if custom.Title != "OpenAI-Compatible" {
		t.Fatalf("expected renamed fallback title, got %q", custom.Title)
	}
}

func TestDeclaredConnectorKindsHaveTemplates(t *testing.T) {
	declaredKinds := []string{KindRESTAPI, KindWebhook, KindMCP, KindHTTPGateway, KindSMTP, KindDNS, KindRegistry, KindProxy}
	for _, kind := range declaredKinds {
		t.Run(kind, func(t *testing.T) {
			templates, err := TemplatesByKind(kind)
			if err != nil {
				t.Fatalf("load templates for %q: %v", kind, err)
			}
			if len(templates) == 0 {
				t.Fatalf("expected at least one template for kind %q", kind)
			}
		})
	}
}

func TestFindTemplateLoadsGenericNonLLMTemplates(t *testing.T) {
	testCases := []struct {
		id   string
		kind string
	}{
		{id: "generic-smtp", kind: KindSMTP},
		{id: "generic-dns", kind: KindDNS},
		{id: "generic-http-gateway", kind: KindHTTPGateway},
		{id: "generic-registry", kind: KindRegistry},
		{id: "http-proxy", kind: KindProxy},
		{id: "socks5-proxy", kind: KindProxy},
	}

	for _, tc := range testCases {
		t.Run(tc.id, func(t *testing.T) {
			template, ok, err := FindTemplate(tc.id)
			if err != nil {
				t.Fatalf("find template %q: %v", tc.id, err)
			}
			if !ok {
				t.Fatalf("expected template %q to be loaded", tc.id)
			}
			if template.Kind != tc.kind {
				t.Fatalf("expected kind %q, got %q", tc.kind, template.Kind)
			}
			if len(template.Fields) == 0 {
				t.Fatalf("expected template %q to declare fields", tc.id)
			}
		})
	}
}
