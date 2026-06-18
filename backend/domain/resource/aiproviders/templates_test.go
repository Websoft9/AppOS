package aiproviders

import (
	"encoding/json"
	"io/fs"
	"path"
	"strings"
	"testing"
)

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
	if template.ProviderMode != "vendor" {
		t.Fatalf("expected provider mode vendor, got %q", template.ProviderMode)
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
	if template.Title != "Custom OpenAI-compatible" {
		t.Fatalf("expected renamed title, got %q", template.Title)
	}
	if template.Vendor != "Custom OpenAI-compatible" {
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
	if template.Title != "xAI Grok" {
		t.Fatalf("expected xAI title, got %q", template.Title)
	}
	if template.DefaultEndpoint != "https://api.x.ai/v1" {
		t.Fatalf("unexpected xAI default endpoint %q", template.DefaultEndpoint)
	}
	if template.ContextSize != 131072 {
		t.Fatalf("unexpected xAI context size %d", template.ContextSize)
	}
}

func TestTemplateEndpointFieldInheritsDefaultEndpoint(t *testing.T) {
	template, ok := FindTemplate("alibaba-cloud-bailian")
	if !ok {
		t.Fatalf("expected embedded Bailian template to be loaded")
	}
	for _, field := range template.Fields {
		if field.ID != "endpoint" {
			continue
		}
		if field.Default != template.DefaultEndpoint {
			t.Fatalf("expected endpoint field default %q, got %#v", template.DefaultEndpoint, field.Default)
		}
		return
	}
	t.Fatal("expected Bailian template to expose endpoint field")
}

func TestTemplateProtocolInheritsDefaultEndpoint(t *testing.T) {
	template, ok := FindTemplate("alibaba-cloud-bailian")
	if !ok {
		t.Fatalf("expected embedded Bailian template to be loaded")
	}
	if len(template.Protocols) != 1 {
		t.Fatalf("expected one Bailian protocol, got %#v", template.Protocols)
	}
	if template.Protocols[0].DefaultEndpoint != template.DefaultEndpoint {
		t.Fatalf("expected protocol endpoint default %q, got %q", template.DefaultEndpoint, template.Protocols[0].DefaultEndpoint)
	}
}

func TestHiddenTemplateMetadataLoads(t *testing.T) {
	template, ok := FindTemplate("qwen-dashscope")
	if !ok {
		t.Fatalf("expected embedded Qwen template to be loaded")
	}
	if !template.HideInChooser {
		t.Fatal("expected qwen-dashscope to be hidden in chooser")
	}
}

func TestTemplateSourceOmitsRedundantEndpointDefaults(t *testing.T) {
	entries, err := fs.ReadDir(embeddedTemplateFiles, path.Join("templates", KindLLM))
	if err != nil {
		t.Fatalf("read llm templates: %v", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") || entry.Name() == "_template.json" {
			continue
		}
		filePath := path.Join("templates", KindLLM, entry.Name())
		file, err := readTemplateFile(filePath)
		if err != nil {
			t.Fatalf("read template %s: %v", filePath, err)
		}
		if file.DefaultEndpoint == nil {
			continue
		}
		defaultEndpoint := strings.TrimSpace(*file.DefaultEndpoint)
		if defaultEndpoint == "" {
			continue
		}
		for _, protocol := range file.Protocols {
			if protocol.DefaultEndpoint == nil {
				continue
			}
			if strings.TrimSpace(*protocol.DefaultEndpoint) == defaultEndpoint {
				t.Fatalf("template %s redundantly repeats defaultEndpoint in protocol %q", entry.Name(), protocol.ID)
			}
		}
		for _, field := range file.Fields {
			if strings.TrimSpace(field.ID) != "endpoint" || field.Default == nil {
				continue
			}
			var decoded any
			if err := json.Unmarshal(field.Default, &decoded); err != nil {
				t.Fatalf("decode endpoint default for %s: %v", entry.Name(), err)
			}
			if value := strings.TrimSpace(decoded.(string)); value == defaultEndpoint {
				t.Fatalf("template %s redundantly repeats defaultEndpoint in endpoint field", entry.Name())
			}
		}
	}
}

func TestOpenRouterTemplateHasMaxCompletionTokensDefault(t *testing.T) {
	template, ok := FindTemplate("openrouter")
	if !ok {
		t.Fatalf("expected embedded OpenRouter template to be loaded")
	}
	for _, field := range template.Fields {
		if field.ID != "max_completion_tokens" {
			continue
		}
		if field.Type != "number" {
			t.Fatalf("expected max_completion_tokens type number, got %q", field.Type)
		}
		if field.Default != float64(31100) {
			t.Fatalf("expected openrouter max_completion_tokens default 31100, got %#v", field.Default)
		}
		return
	}
	t.Fatal("expected openrouter template to expose max_completion_tokens field")
}

func TestTemplateMetadataConventions(t *testing.T) {
	for _, template := range Templates() {
		switch template.ProviderMode {
		case "vendor", "gateway":
		default:
			t.Fatalf("template %s has unexpected provider mode %q", template.ID, template.ProviderMode)
		}

		switch template.EndpointMode {
		case "customizable", "fixed":
			if strings.TrimSpace(template.DefaultEndpoint) == "" {
				t.Fatalf("template %s uses endpointMode=%q but has no defaultEndpoint", template.ID, template.EndpointMode)
			}
		case "user_supplied":
			if strings.TrimSpace(template.DefaultEndpoint) != "" {
				t.Fatalf("template %s uses endpointMode=user_supplied but still declares defaultEndpoint %q", template.ID, template.DefaultEndpoint)
			}
		default:
			t.Fatalf("template %s has unexpected endpoint mode %q", template.ID, template.EndpointMode)
		}

		if template.ProviderMode == "gateway" && strings.TrimSpace(template.UIGroup) != "cloud_gateway" {
			t.Fatalf("template %s uses providerMode=gateway but uiGroup=%q", template.ID, template.UIGroup)
		}

		if template.HideInChooser && len(template.Aliases) == 0 {
			t.Fatalf("template %s is hidden in chooser but has no aliases for search/discovery", template.ID)
		}

		if template.HostingMode == "cloud" && (template.UIGroup == "single_provider" || template.UIGroup == "cloud_gateway") {
			if template.EndpointMode == "customizable" && strings.TrimSpace(template.DefaultEndpoint) == "" {
				t.Fatalf("hosted template %s should declare a stable defaultEndpoint when endpointMode=customizable", template.ID)
			}
		}
	}

	if openAI, ok := FindTemplate("openai"); !ok {
		t.Fatal("expected embedded openai template to be loaded")
	} else if openAI.DefaultAuth != "bearer" {
		t.Fatalf("expected openai default auth bearer, got %q", openAI.DefaultAuth)
	}

	if anthropic, ok := FindTemplate("anthropic"); !ok {
		t.Fatal("expected embedded anthropic template to be loaded")
	} else if anthropic.DefaultAuth != "api_key" {
		t.Fatalf("expected anthropic default auth api_key, got %q", anthropic.DefaultAuth)
	}

	if generic, ok := FindTemplate("generic-llm"); !ok {
		t.Fatal("expected embedded generic-llm template to be loaded")
	} else {
		for _, field := range generic.Fields {
			if field.ID == "notes" {
				t.Fatal("expected generic-llm notes field to be removed")
			}
		}
	}

	if zai, ok := FindTemplate("z-ai"); !ok {
		t.Fatal("expected embedded z-ai template to be loaded")
	} else {
		for _, field := range zai.Fields {
			if field.ID == "coding_endpoint" {
				t.Fatal("expected z-ai coding_endpoint field to be removed")
			}
		}
	}
}
