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

func TestFindTemplateLoadsEmbeddedOpenAI(t *testing.T) {
	template, ok := FindTemplate("openai")
	if !ok {
		t.Fatalf("expected embedded openai template to be loaded")
	}
	if template.Kind != KindLLM {
		t.Fatalf("expected kind %q, got %q", KindLLM, template.Kind)
	}
	if template.DefaultEndpoint != "https://api.openai.com/v1" {
		t.Fatalf("unexpected default endpoint %q", template.DefaultEndpoint)
	}
	if len(template.Fields) == 0 {
		t.Fatalf("expected openai template fields to be loaded")
	}
	if template.Fields[0].ID != "endpoint" {
		t.Fatalf("expected first field to be endpoint, got %q", template.Fields[0].ID)
	}
	if template.Fields[1].ID != "credential" || !template.Fields[1].Required || !template.Fields[1].Sensitive {
		t.Fatalf("expected openai credential field to inherit base auth requirements")
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
}

func TestDeclaredConnectorKindsHaveTemplates(t *testing.T) {
	declaredKinds := []string{KindLLM, KindRESTAPI, KindWebhook, KindMCP, KindSMTP, KindDNS, KindRegistry}
	for _, kind := range declaredKinds {
		t.Run(kind, func(t *testing.T) {
			templates := TemplatesByKind(kind)
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
		{id: "generic-registry", kind: KindRegistry},
	}

	for _, tc := range testCases {
		t.Run(tc.id, func(t *testing.T) {
			template, ok := FindTemplate(tc.id)
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

func TestCustomLLMOverridesBaseAuthDefaults(t *testing.T) {
	template, ok := FindTemplate("generic-llm")
	if !ok {
		t.Fatalf("expected generic llm template to be loaded")
	}
	if template.DefaultAuth != AuthSchemeNone {
		t.Fatalf("expected custom llm auth scheme %q, got %q", AuthSchemeNone, template.DefaultAuth)
	}
	if len(template.Fields) < 2 || template.Fields[1].ID != "credential" || template.Fields[1].Required {
		t.Fatalf("expected custom llm credential field to override base required flag")
	}
}