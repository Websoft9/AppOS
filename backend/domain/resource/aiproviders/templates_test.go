package aiproviders

import "testing"

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
	if template.ContextSize != 128000 {
		t.Fatalf("unexpected context size %d", template.ContextSize)
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

func TestOpenAICompatibleTemplateRenamed(t *testing.T) {
	template, ok := FindTemplate(TemplateOpenAICompatible)
	if !ok {
		t.Fatalf("expected OpenAI-Compatible template to be loaded")
	}
	if template.Title != "OpenAI-Compatible" {
		t.Fatalf("expected renamed title, got %q", template.Title)
	}
	if template.Vendor != "OpenAI-Compatible" {
		t.Fatalf("expected renamed vendor, got %q", template.Vendor)
	}
	if len(template.Fields) < 2 || template.Fields[1].ID != "credential" || template.Fields[1].Required {
		t.Fatalf("expected OpenAI-Compatible credential field to remain optional")
	}
}

func TestFindTemplateLoadsEmbeddedXAI(t *testing.T) {
	template, ok := FindTemplate("xai")
	if !ok {
		t.Fatalf("expected embedded xAI template to be loaded")
	}
	if template.Title != "xAI" {
		t.Fatalf("expected xAI title, got %q", template.Title)
	}
	if template.DefaultEndpoint != "https://api.x.ai/v1" {
		t.Fatalf("unexpected xAI default endpoint %q", template.DefaultEndpoint)
	}
	if template.ContextSize != 131072 {
		t.Fatalf("unexpected xAI context size %d", template.ContextSize)
	}
}
