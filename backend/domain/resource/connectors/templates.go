package connectors

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"sort"
	"strings"
	"sync"
)

//go:embed templates/*.json
var embeddedTemplateFiles embed.FS

var builtInTemplates = []Template{
	{ID: TemplateAnthropic, Kind: KindLLM, Title: "Anthropic", DefaultEndpoint: "https://api.anthropic.com", DefaultAuth: AuthSchemeAPIKey, Aliases: []string{"anthropic"}},
	{ID: TemplateGemini, Kind: KindLLM, Title: "Google Gemini", DefaultEndpoint: "https://generativelanguage.googleapis.com/v1beta", DefaultAuth: AuthSchemeAPIKey, Aliases: []string{"google gemini", "gemini", "google-gemini"}},
	{ID: TemplateMistral, Kind: KindLLM, Title: "Mistral", DefaultEndpoint: "https://api.mistral.ai/v1", DefaultAuth: AuthSchemeAPIKey, Aliases: []string{"mistral"}},
	{ID: TemplateDeepSeek, Kind: KindLLM, Title: "DeepSeek", DefaultEndpoint: "https://api.deepseek.com/v1", DefaultAuth: AuthSchemeAPIKey, Aliases: []string{"deepseek"}},
	{ID: TemplateGroq, Kind: KindLLM, Title: "Groq", DefaultEndpoint: "https://api.groq.com/openai/v1", DefaultAuth: AuthSchemeAPIKey, Aliases: []string{"groq"}},
	{ID: TemplateOpenRouter, Kind: KindLLM, Title: "OpenRouter", DefaultEndpoint: "https://openrouter.ai/api/v1", DefaultAuth: AuthSchemeAPIKey, Aliases: []string{"openrouter"}},
	{ID: TemplateAzureOpenAI, Kind: KindLLM, Title: "Azure OpenAI", DefaultEndpoint: "https://{resource}.openai.azure.com/openai/deployments/{model}", DefaultAuth: AuthSchemeAPIKey, Aliases: []string{"azure openai", "azure-openai"}},
	{ID: TemplateOllama, Kind: KindLLM, Title: "Ollama", DefaultEndpoint: "http://localhost:11434/v1", DefaultAuth: AuthSchemeNone, Aliases: []string{"ollama"}},
	{ID: TemplateCustomLLM, Kind: KindLLM, Title: "Custom LLM", DefaultEndpoint: "", DefaultAuth: AuthSchemeNone, Aliases: []string{"custom", "custom-llm"}},
	{ID: TemplateGenericREST, Kind: KindRESTAPI, Title: "Generic REST API", DefaultEndpoint: "", DefaultAuth: AuthSchemeNone, Aliases: []string{"rest", "generic-rest"}},
	{ID: TemplateGenericWebhook, Kind: KindWebhook, Title: "Generic Webhook", DefaultEndpoint: "", DefaultAuth: AuthSchemeNone, Aliases: []string{"webhook", "generic-webhook"}},
	{ID: TemplateGenericMCP, Kind: KindMCP, Title: "Generic MCP", DefaultEndpoint: "", DefaultAuth: AuthSchemeNone, Aliases: []string{"mcp", "generic-mcp"}},
}

var (
	templatesOnce sync.Once
	templatesErr  error
	templates     []Template
)

func Templates() []Template {
	ensureTemplatesLoaded()
	result := make([]Template, len(templates))
	copy(result, templates)
	return result
}

func TemplatesByKind(kind string) []Template {
	ensureTemplatesLoaded()
	var result []Template
	for _, template := range templates {
		if template.Kind == kind {
			result = append(result, template)
		}
	}
	return result
}

func FindTemplate(id string) (Template, bool) {
	ensureTemplatesLoaded()
	for _, template := range templates {
		if template.ID == id {
			return template, true
		}
	}
	return Template{}, false
}

func ResolveLLMTemplate(name string) Template {
	ensureTemplatesLoaded()
	normalized := normalizeTemplateKey(name)
	for _, template := range templates {
		if template.Kind != KindLLM {
			continue
		}
		if normalizeTemplateKey(template.Title) == normalized {
			return template
		}
		for _, alias := range template.Aliases {
			if normalizeTemplateKey(alias) == normalized {
				return template
			}
		}
	}
	custom, _ := FindTemplate(TemplateCustomLLM)
	return custom
}

func ensureTemplatesLoaded() {
	templatesOnce.Do(func() {
		templatesErr = loadTemplates()
		if templatesErr != nil {
			panic(templatesErr)
		}
	})
}

func loadTemplates() error {
	templateMap := make(map[string]Template, len(builtInTemplates))
	for _, template := range builtInTemplates {
		templateMap[template.ID] = template
	}

	entries, err := fs.ReadDir(embeddedTemplateFiles, "templates")
	if err != nil {
		return fmt.Errorf("read connector templates: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		content, err := embeddedTemplateFiles.ReadFile("templates/" + entry.Name())
		if err != nil {
			return fmt.Errorf("read connector template %s: %w", entry.Name(), err)
		}
		var template Template
		if err := json.Unmarshal(content, &template); err != nil {
			return fmt.Errorf("parse connector template %s: %w", entry.Name(), err)
		}
		if err := validateTemplate(template); err != nil {
			return fmt.Errorf("invalid connector template %s: %w", entry.Name(), err)
		}
		templateMap[template.ID] = template
	}

	keys := make([]string, 0, len(templateMap))
	for key := range templateMap {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	templates = make([]Template, 0, len(keys))
	for _, key := range keys {
		templates = append(templates, templateMap[key])
	}
	return nil
}

func validateTemplate(template Template) error {
	if strings.TrimSpace(template.ID) == "" {
		return fmt.Errorf("template id is required")
	}
	if strings.TrimSpace(template.Kind) == "" {
		return fmt.Errorf("template kind is required")
	}
	if strings.TrimSpace(template.Title) == "" {
		return fmt.Errorf("template title is required")
	}
	return nil
}

func normalizeTemplateKey(raw string) string {
	trimmed := strings.TrimSpace(strings.ToLower(raw))
	trimmed = strings.ReplaceAll(trimmed, "_", "-")
	trimmed = strings.ReplaceAll(trimmed, " ", "-")
	return trimmed
}