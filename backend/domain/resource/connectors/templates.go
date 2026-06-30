package connectors

import (
	"embed"
	"encoding/json"
	"fmt"
	"path"
	"strings"
	"sync"

	resourceshared "github.com/websoft9/appos/backend/domain/resource/shared"
)

//go:embed all:templates
var embeddedTemplateFiles embed.FS

var (
	templatesOnce sync.Once
	templatesErr  error
	templates     []Template
)

func Templates() []Template {
	templates, err := TemplatesWithError()
	if err != nil {
		return nil
	}
	return templates
}

func TemplatesWithError() ([]Template, error) {
	if err := ensureTemplatesLoaded(); err != nil {
		return nil, err
	}
	result := make([]Template, len(templates))
	copy(result, templates)
	return result, nil
}

func TemplatesByKind(kind string) ([]Template, error) {
	if err := ensureTemplatesLoaded(); err != nil {
		return nil, err
	}
	var result []Template
	for _, template := range templates {
		if template.Kind == kind {
			result = append(result, template)
		}
	}
	return result, nil
}

func FindTemplate(id string) (Template, bool, error) {
	if err := ensureTemplatesLoaded(); err != nil {
		return Template{}, false, err
	}
	for _, template := range templates {
		if template.ID == id {
			return template, true, nil
		}
	}
	return Template{}, false, nil
}

func ResolveLLMTemplate(name string) Template {
	normalized := normalizeTemplateKey(name)
	for _, template := range legacyLLMTemplates {
		if normalizeTemplateKey(template.Title) == normalized {
			return template
		}
		for _, alias := range template.Aliases {
			if normalizeTemplateKey(alias) == normalized {
				return template
			}
		}
	}
	return legacyLLMTemplates[len(legacyLLMTemplates)-1]
}

var legacyLLMTemplates = []Template{
	{
		ID:              "openai",
		Kind:            KindLLM,
		Title:           "OpenAI",
		Vendor:          "OpenAI",
		DefaultEndpoint: "https://api.openai.com/v1",
		DefaultAuth:     AuthSchemeAPIKey,
		Aliases:         []string{"openai"},
	},
	{
		ID:              "azure-openai",
		Kind:            KindLLM,
		Title:           "Azure OpenAI",
		Vendor:          "Microsoft Azure",
		DefaultEndpoint: "https://{resource}.openai.azure.com/openai/deployments/{deployment}",
		DefaultAuth:     AuthSchemeAPIKey,
		Aliases:         []string{"azure openai", "azure-openai"},
	},
	{
		ID:              TemplateGenericLLM,
		Kind:            KindLLM,
		Title:           "OpenAI-Compatible",
		Vendor:          "OpenAI-Compatible",
		DefaultEndpoint: "",
		DefaultAuth:     AuthSchemeNone,
		Aliases:         []string{"generic", "generic-llm", "custom", "custom-llm", "openai-compatible"},
	},
}

func ensureTemplatesLoaded() error {
	templatesOnce.Do(func() {
		templatesErr = loadTemplates()
	})
	return templatesErr
}

func loadTemplates() error {
	loaded, err := resourceshared.LoadTemplates(
		embeddedTemplateFiles,
		func(filePath string) (templateFile, error) {
			file, err := readTemplateFile(filePath)
			if err != nil {
				return templateFile{}, fmt.Errorf("read connector template %s: %w", filePath, err)
			}
			return file, nil
		},
		loadKindBaseTemplate,
		func(base Template, overlay templateFile, filePath string) (Template, error) {
			template, err := applyTemplateOverlay(base, overlay)
			if err != nil {
				return Template{}, fmt.Errorf("merge connector template %s: %w", filePath, err)
			}
			if err := validateTemplate(template); err != nil {
				return Template{}, fmt.Errorf("invalid connector template %s: %w", filePath, err)
			}
			return template, nil
		},
		func(template Template) string { return template.ID },
	)
	if err != nil {
		return fmt.Errorf("read connector templates: %w", err)
	}
	templates = loaded
	return nil
}

type templateFile struct {
	ID              *string             `json:"id,omitempty"`
	Kind            *string             `json:"kind,omitempty"`
	Title           *string             `json:"title,omitempty"`
	Vendor          *string             `json:"vendor,omitempty"`
	Category        *string             `json:"category,omitempty"`
	Description     *string             `json:"description,omitempty"`
	DefaultEndpoint *string             `json:"defaultEndpoint,omitempty"`
	DefaultAuth     *string             `json:"defaultAuthScheme,omitempty"`
	Capabilities    []string            `json:"capabilities,omitempty"`
	Aliases         []string            `json:"aliases,omitempty"`
	Fields          []templateFieldFile `json:"fields,omitempty"`
}

type templateFieldFile struct {
	ID             string          `json:"id,omitempty"`
	Label          *string         `json:"label,omitempty"`
	Type           *string         `json:"type,omitempty"`
	Required       *bool           `json:"required,omitempty"`
	Sensitive      *bool           `json:"sensitive,omitempty"`
	SecretTemplate *string         `json:"secretTemplate,omitempty"`
	Placeholder    *string         `json:"placeholder,omitempty"`
	HelpText       *string         `json:"helpText,omitempty"`
	Default        json.RawMessage `json:"default,omitempty"`
}

func loadKindBaseTemplate(kind string) (Template, error) {
	base := Template{Kind: kind}
	filePath := path.Join("templates", kind, "_template.json")
	file, err := readTemplateFile(filePath)
	if err != nil {
		return Template{}, fmt.Errorf("read connector base template %s: %w", filePath, err)
	}
	base, err = applyTemplateOverlay(base, file)
	if err != nil {
		return Template{}, fmt.Errorf("merge connector base template %s: %w", filePath, err)
	}
	if strings.TrimSpace(base.Kind) != kind {
		return Template{}, fmt.Errorf("base template kind %q does not match directory %q", base.Kind, kind)
	}
	return base, nil
}

func readTemplateFile(filePath string) (templateFile, error) {
	content, err := embeddedTemplateFiles.ReadFile(filePath)
	if err != nil {
		return templateFile{}, err
	}
	var file templateFile
	if err := json.Unmarshal(content, &file); err != nil {
		return templateFile{}, fmt.Errorf("parse JSON: %w", err)
	}
	return file, nil
}

func applyTemplateOverlay(base Template, file templateFile) (Template, error) {
	result := base

	if file.ID != nil {
		result.ID = NormalizeTemplateID(*file.ID)
	}
	if file.Kind != nil {
		result.Kind = strings.TrimSpace(*file.Kind)
	}
	if file.Title != nil {
		result.Title = strings.TrimSpace(*file.Title)
	}
	if file.Vendor != nil {
		result.Vendor = strings.TrimSpace(*file.Vendor)
	}
	if file.Category != nil {
		result.Category = strings.TrimSpace(*file.Category)
	}
	if file.Description != nil {
		result.Description = strings.TrimSpace(*file.Description)
	}
	if file.DefaultEndpoint != nil {
		result.DefaultEndpoint = strings.TrimSpace(*file.DefaultEndpoint)
	}
	if file.DefaultAuth != nil {
		result.DefaultAuth = strings.TrimSpace(*file.DefaultAuth)
	}
	if file.Capabilities != nil {
		result.Capabilities = append([]string(nil), file.Capabilities...)
	}
	if file.Aliases != nil {
		result.Aliases = append([]string(nil), file.Aliases...)
	}
	if file.Fields != nil {
		fields, err := mergeTemplateFields(base.Fields, file.Fields)
		if err != nil {
			return Template{}, err
		}
		result.Fields = fields
	}

	return result, nil
}

func mergeTemplateFields(base []TemplateField, overrides []templateFieldFile) ([]TemplateField, error) {
	result := append([]TemplateField(nil), base...)
	indexByID := make(map[string]int, len(result))
	for index, field := range result {
		indexByID[field.ID] = index
	}

	for _, override := range overrides {
		if strings.TrimSpace(override.ID) == "" {
			return nil, fmt.Errorf("template field id is required")
		}
		if index, ok := indexByID[override.ID]; ok {
			merged, err := applyFieldOverlay(result[index], override)
			if err != nil {
				return nil, err
			}
			result[index] = merged
			continue
		}
		merged, err := applyFieldOverlay(TemplateField{ID: override.ID}, override)
		if err != nil {
			return nil, err
		}
		indexByID[override.ID] = len(result)
		result = append(result, merged)
	}

	return result, nil
}

func applyFieldOverlay(base TemplateField, override templateFieldFile) (TemplateField, error) {
	result := base
	result.ID = override.ID
	if override.Label != nil {
		result.Label = strings.TrimSpace(*override.Label)
	}
	if override.Type != nil {
		result.Type = strings.TrimSpace(*override.Type)
	}
	if override.Required != nil {
		result.Required = *override.Required
	}
	if override.Sensitive != nil {
		result.Sensitive = *override.Sensitive
	}
	if override.SecretTemplate != nil {
		result.SecretTemplate = strings.TrimSpace(*override.SecretTemplate)
	}
	if override.Placeholder != nil {
		result.Placeholder = strings.TrimSpace(*override.Placeholder)
	}
	if override.HelpText != nil {
		result.HelpText = strings.TrimSpace(*override.HelpText)
	}
	if override.Default != nil {
		var value any
		if err := json.Unmarshal(override.Default, &value); err != nil {
			return TemplateField{}, fmt.Errorf("parse field default for %q: %w", override.ID, err)
		}
		result.Default = value
	}
	return result, nil
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
	for _, field := range template.Fields {
		if strings.TrimSpace(field.ID) == "" {
			return fmt.Errorf("template field id is required")
		}
		if strings.TrimSpace(field.Label) == "" {
			return fmt.Errorf("template field %q label is required", field.ID)
		}
		if strings.TrimSpace(field.Type) == "" {
			return fmt.Errorf("template field %q type is required", field.ID)
		}
	}
	return nil
}

func normalizeTemplateKey(raw string) string {
	trimmed := strings.TrimSpace(strings.ToLower(raw))
	trimmed = strings.ReplaceAll(trimmed, "_", "-")
	trimmed = strings.ReplaceAll(trimmed, " ", "-")
	return trimmed
}
