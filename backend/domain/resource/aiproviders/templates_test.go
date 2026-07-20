package aiproviders

import (
	"encoding/json"
	"io/fs"
	"path"
	"strings"
	"testing"
)

func TestFindTemplateLoadsEmbeddedOpenAI(t *testing.T) {
	template, ok, err := FindTemplate("openai")
	if err != nil {
		t.Fatalf("find template: %v", err)
	}
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
	template, ok, err := FindTemplate(TemplateOpenAICompatible)
	if err != nil {
		t.Fatalf("find template: %v", err)
	}
	if !ok {
		t.Fatalf("expected OpenAI-Compatible template to be loaded")
	}
	if template.Title != "Custom OpenAI-compatible" {
		t.Fatalf("expected renamed title, got %q", template.Title)
	}
	if template.Vendor != "Custom OpenAI-compatible" {
		t.Fatalf("expected renamed vendor, got %q", template.Vendor)
	}
	if len(template.Fields) < 2 || template.Fields[1].ID != "credential" || !template.Fields[1].Required {
		t.Fatalf("expected OpenAI-Compatible credential field to require a bearer-style credential")
	}
}

func TestFindTemplateLoadsEmbeddedXAI(t *testing.T) {
	template, ok, err := FindTemplate("xai")
	if err != nil {
		t.Fatalf("find template: %v", err)
	}
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
	template, ok, err := FindTemplate("alibaba-cloud-bailian")
	if err != nil {
		t.Fatalf("find template: %v", err)
	}
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
	template, ok, err := FindTemplate("alibaba-cloud-bailian")
	if err != nil {
		t.Fatalf("find template: %v", err)
	}
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

func TestHostedProviderEndpointAndCredentialContracts(t *testing.T) {
	templateIDs := []string{"writer", "vertex-ai", "nvidia-nim-cloud"}
	for _, templateID := range templateIDs {
		template, ok, err := FindTemplate(templateID)
		if err != nil {
			t.Fatalf("find template %s: %v", templateID, err)
		}
		if !ok {
			t.Fatalf("expected embedded template %s to be loaded", templateID)
		}
		if template.EndpointMode != "customizable" {
			t.Fatalf("expected %s endpointMode customizable, got %q", templateID, template.EndpointMode)
		}
		if strings.TrimSpace(template.DefaultEndpoint) == "" {
			t.Fatalf("expected %s to define a default endpoint", templateID)
		}
		endpointField, ok := templateFieldByID(template, "endpoint")
		if !ok || !endpointField.Required {
			t.Fatalf("expected %s endpoint field to be required", templateID)
		}
		credentialField, ok := templateFieldByID(template, "credential")
		if !ok || !credentialField.Required || credentialField.Label != "API Key" {
			t.Fatalf("expected %s credential to be a required API Key field", templateID)
		}
	}
}

func TestVertexAndBedrockRequiredFields(t *testing.T) {
	vertex, ok, err := FindTemplate("vertex-ai")
	if err != nil {
		t.Fatalf("find vertex template: %v", err)
	}
	if !ok {
		t.Fatal("expected embedded Vertex AI template to be loaded")
	}
	for _, fieldID := range []string{"project_id", "location"} {
		field, ok := templateFieldByID(vertex, fieldID)
		if !ok || !field.Required {
			t.Fatalf("expected vertex field %s to be required", fieldID)
		}
	}

	bedrock, ok, err := FindTemplate("aws-bedrock")
	if err != nil {
		t.Fatalf("find bedrock template: %v", err)
	}
	if !ok {
		t.Fatal("expected embedded AWS Bedrock template to be loaded")
	}
	regionField, ok := templateFieldByID(bedrock, "region")
	if !ok || !regionField.Required {
		t.Fatal("expected AWS Bedrock region field to be required")
	}
}

func TestSelfHostedProviderEndpointAndCredentialContracts(t *testing.T) {
	templateIDs := []string{"ollama", "vllm", "sglang", "nvidia-nim-local", TemplateOpenAICompatible}
	for _, templateID := range templateIDs {
		template, ok, err := FindTemplate(templateID)
		if err != nil {
			t.Fatalf("find template %s: %v", templateID, err)
		}
		if !ok {
			t.Fatalf("expected embedded template %s to be loaded", templateID)
		}
		if template.EndpointMode != "user_supplied" {
			t.Fatalf("expected %s endpointMode user_supplied, got %q", templateID, template.EndpointMode)
		}
		if strings.TrimSpace(template.DefaultEndpoint) != "" {
			t.Fatalf("expected %s to omit default endpoint, got %q", templateID, template.DefaultEndpoint)
		}
		if template.DefaultAuth != AuthSchemeBearer {
			t.Fatalf("expected %s default auth scheme bearer, got %q", templateID, template.DefaultAuth)
		}
		endpointField, ok := templateFieldByID(template, "endpoint")
		if !ok || !endpointField.Required {
			t.Fatalf("expected %s endpoint field to be required", templateID)
		}
		credentialField, ok := templateFieldByID(template, "credential")
		if !ok || !credentialField.Required || credentialField.Label != "API Key" {
			t.Fatalf("expected %s credential to be a required API Key field", templateID)
		}
	}
}

func TestOpenAIOrganizationFieldIsAdvanced(t *testing.T) {
	template, ok, err := FindTemplate("openai")
	if err != nil {
		t.Fatalf("find template: %v", err)
	}
	if !ok {
		t.Fatal("expected embedded OpenAI template to be loaded")
	}
	field, ok := templateFieldByID(template, "organization")
	if !ok || !field.Advanced {
		t.Fatal("expected OpenAI organization field to be marked advanced")
	}
}

func TestHiddenTemplateMetadataLoads(t *testing.T) {
	template, ok, err := FindTemplate("qwen-dashscope")
	if err != nil {
		t.Fatalf("find template: %v", err)
	}
	if !ok {
		t.Fatalf("expected embedded Qwen template to be loaded")
	}
	if !template.HideInChooser {
		t.Fatal("expected qwen-dashscope to be hidden in chooser")
	}
}

func templateFieldByID(template Template, fieldID string) (TemplateField, bool) {
	for _, field := range template.Fields {
		if field.ID == fieldID {
			return field, true
		}
	}
	return TemplateField{}, false
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
	template, ok, err := FindTemplate("openrouter")
	if err != nil {
		t.Fatalf("find template: %v", err)
	}
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
	templates, err := Templates()
	if err != nil {
		t.Fatalf("load templates: %v", err)
	}
	for _, template := range templates {
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

	if openAI, ok, err := FindTemplate("openai"); err != nil {
		t.Fatalf("find openai template: %v", err)
	} else if !ok {
		t.Fatal("expected embedded openai template to be loaded")
	} else if openAI.DefaultAuth != "bearer" {
		t.Fatalf("expected openai default auth bearer, got %q", openAI.DefaultAuth)
	}

	if anthropic, ok, err := FindTemplate("anthropic"); err != nil {
		t.Fatalf("find anthropic template: %v", err)
	} else if !ok {
		t.Fatal("expected embedded anthropic template to be loaded")
	} else if anthropic.DefaultAuth != "api_key" {
		t.Fatalf("expected anthropic default auth api_key, got %q", anthropic.DefaultAuth)
	} else {
		for _, field := range anthropic.Fields {
			if field.ID == "version" && !field.Advanced {
				t.Fatal("expected anthropic API version field to be marked advanced")
			}
		}
	}

	if generic, ok, err := FindTemplate("generic-llm"); err != nil {
		t.Fatalf("find generic-llm template: %v", err)
	} else if !ok {
		t.Fatal("expected embedded generic-llm template to be loaded")
	} else {
		if generic.DefaultAuth != "bearer" {
			t.Fatalf("expected generic-llm default auth bearer, got %q", generic.DefaultAuth)
		}
		for _, field := range generic.Fields {
			if field.ID == "notes" {
				t.Fatal("expected generic-llm notes field to be removed")
			}
		}
	}

	if azureOpenAI, ok, err := FindTemplate("azure-openai"); err != nil {
		t.Fatalf("find azure-openai template: %v", err)
	} else if !ok {
		t.Fatal("expected embedded azure-openai template to be loaded")
	} else {
		for _, field := range azureOpenAI.Fields {
			if field.ID == "apiVersion" && !field.Advanced {
				t.Fatal("expected azure-openai apiVersion field to be marked advanced")
			}
		}
	}

	for _, id := range []string{"ollama", "vllm", "sglang", "nvidia-nim-local"} {
		template, ok, err := FindTemplate(id)
		if err != nil {
			t.Fatalf("find %s template: %v", id, err)
		}
		if !ok {
			t.Fatalf("expected embedded %s template to be loaded", id)
		}
		if template.DefaultAuth != AuthSchemeBearer {
			t.Fatalf("expected %s default auth bearer, got %q", id, template.DefaultAuth)
		}
	}

	if zai, ok, err := FindTemplate("z-ai"); err != nil {
		t.Fatalf("find z-ai template: %v", err)
	} else if !ok {
		t.Fatal("expected embedded z-ai template to be loaded")
	} else {
		for _, field := range zai.Fields {
			if field.ID == "coding_endpoint" {
				t.Fatal("expected z-ai coding_endpoint field to be removed")
			}
		}
	}
}
