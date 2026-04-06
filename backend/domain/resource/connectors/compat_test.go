package connectors

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/resource/endpoints"
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
}

func TestSpecFromEndpoint(t *testing.T) {
	col := core.NewBaseCollection(endpoints.Collection)
	rec := core.NewRecord(col)
	rec.Set("name", "Ops Webhook")
	rec.Set("type", "webhook")
	rec.Set("url", "https://hooks.example.com/deploy")
	rec.Set("auth_type", "bearer")
	rec.Set("credential", "secret_1")
	rec.Set("extra", map[string]any{"event": "deploy.finished"})
	rec.Set("description", "notify deploy finished")

	spec := SpecFromEndpoint(endpoints.From(rec))

	if spec.Kind != KindWebhook {
		t.Fatalf("expected kind %q, got %q", KindWebhook, spec.Kind)
	}
	if spec.TemplateID != "generic-webhook" {
		t.Fatalf("expected template_id generic-webhook, got %q", spec.TemplateID)
	}
	if spec.AuthScheme != AuthSchemeBearer {
		t.Fatalf("expected auth_scheme %q, got %q", AuthSchemeBearer, spec.AuthScheme)
	}
	if spec.CredentialID != "secret_1" {
		t.Fatalf("expected credential id secret_1, got %q", spec.CredentialID)
	}
	if spec.Config["event"] != "deploy.finished" {
		t.Fatalf("expected config event to be preserved")
	}
}

func TestResolveLLMTemplate(t *testing.T) {
	template := ResolveLLMTemplate("Azure OpenAI")
	if template.ID != TemplateAzureOpenAI {
		t.Fatalf("expected Azure OpenAI template, got %q", template.ID)
	}

	custom := ResolveLLMTemplate("Unknown Vendor")
	if custom.ID != TemplateCustomLLM {
		t.Fatalf("expected fallback template %q, got %q", TemplateCustomLLM, custom.ID)
	}
}