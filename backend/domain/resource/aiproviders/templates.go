package aiproviders

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

func Templates() ([]Template, error) {
	if err := ensureTemplatesLoaded(); err != nil {
		return nil, err
	}
	result := make([]Template, len(templates))
	copy(result, templates)
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
				return templateFile{}, fmt.Errorf("read AI provider template %s: %w", filePath, err)
			}
			return file, nil
		},
		loadKindBaseTemplate,
		func(base Template, overlay templateFile, filePath string) (Template, error) {
			template, err := applyTemplateOverlay(base, overlay)
			if err != nil {
				return Template{}, fmt.Errorf("merge AI provider template %s: %w", filePath, err)
			}
			template = applyImplicitTemplateDefaults(template)
			if err := validateTemplate(template); err != nil {
				return Template{}, fmt.Errorf("invalid AI provider template %s: %w", filePath, err)
			}
			return template, nil
		},
		func(template Template) string { return template.ID },
	)
	if err != nil {
		return fmt.Errorf("read AI provider templates: %w", err)
	}
	templates = loaded
	return nil
}

type templateFile struct {
	ID                        *string                `json:"id,omitempty"`
	Kind                      *string                `json:"kind,omitempty"`
	Title                     *string                `json:"title,omitempty"`
	Vendor                    *string                `json:"vendor,omitempty"`
	Category                  *string                `json:"category,omitempty"`
	UIGroup                   *string                `json:"uiGroup,omitempty"`
	HostingMode               *string                `json:"hostingMode,omitempty"`
	ServiceMode               *string                `json:"serviceMode,omitempty"`
	EndpointMode              *string                `json:"endpointMode,omitempty"`
	ProviderMode              *string                `json:"providerMode,omitempty"`
	Description               *string                `json:"description,omitempty"`
	HelpURL                   *string                `json:"helpUrl,omitempty"`
	ContextSize               *int                   `json:"contextSize,omitempty"`
	ModelsEndpoint            *string                `json:"modelsEndpoint,omitempty"`
	DefaultEndpoint           *string                `json:"defaultEndpoint,omitempty"`
	DefaultAuth               *string                `json:"defaultAuthScheme,omitempty"`
	DefaultEnabledModels      []string               `json:"defaultEnabledModels,omitempty"`
	Capabilities              []string               `json:"capabilities,omitempty"`
	Aliases                   []string               `json:"aliases,omitempty"`
	SupportsClosedModels      *bool                  `json:"supportsClosedModels,omitempty"`
	SupportsMultiVendorModels *bool                  `json:"supportsMultiVendorModels,omitempty"`
	Protocols                 []templateProtocolFile `json:"protocols,omitempty"`
	HideInChooser             *bool                  `json:"hideInChooser,omitempty"`
	SkipTLSCertVerify         *bool                  `json:"skipTLSCertVerify,omitempty"`
	Fields                    []templateFieldFile    `json:"fields,omitempty"`
}

type templateProtocolFile struct {
	ID              string  `json:"id,omitempty"`
	Label           *string `json:"label,omitempty"`
	Default         *bool   `json:"default,omitempty"`
	DefaultEndpoint *string `json:"defaultEndpoint,omitempty"`
	ModelsEndpoint  *string `json:"modelsEndpoint,omitempty"`
}

type templateFieldFile struct {
	ID             string          `json:"id,omitempty"`
	Label          *string         `json:"label,omitempty"`
	Type           *string         `json:"type,omitempty"`
	Required       *bool           `json:"required,omitempty"`
	Advanced       *bool           `json:"advanced,omitempty"`
	Sensitive      *bool           `json:"sensitive,omitempty"`
	SecretTemplate *string         `json:"secretTemplate,omitempty"`
	Placeholder    *string         `json:"placeholder,omitempty"`
	HelpURL        *string         `json:"helpUrl,omitempty"`
	HelpText       *string         `json:"helpText,omitempty"`
	Default        json.RawMessage `json:"default,omitempty"`
}

func loadKindBaseTemplate(kind string) (Template, error) {
	base := Template{Kind: kind}
	filePath := path.Join("templates", kind, "_template.json")
	file, err := readTemplateFile(filePath)
	if err != nil {
		return Template{}, fmt.Errorf("read AI provider base template %s: %w", filePath, err)
	}
	base, err = applyTemplateOverlay(base, file)
	if err != nil {
		return Template{}, fmt.Errorf("merge AI provider base template %s: %w", filePath, err)
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
		result.ID = resourceshared.NormalizeTemplateID(*file.ID)
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
	if file.UIGroup != nil {
		result.UIGroup = strings.TrimSpace(*file.UIGroup)
	}
	if file.HostingMode != nil {
		result.HostingMode = strings.TrimSpace(*file.HostingMode)
	}
	if file.ServiceMode != nil {
		result.ServiceMode = strings.TrimSpace(*file.ServiceMode)
	}
	if file.EndpointMode != nil {
		result.EndpointMode = strings.TrimSpace(*file.EndpointMode)
	}
	if file.ProviderMode != nil {
		result.ProviderMode = strings.TrimSpace(*file.ProviderMode)
	}
	if file.Description != nil {
		result.Description = strings.TrimSpace(*file.Description)
	}
	if file.HelpURL != nil {
		result.HelpURL = strings.TrimSpace(*file.HelpURL)
	}
	if file.ContextSize != nil {
		result.ContextSize = *file.ContextSize
	}
	if file.ModelsEndpoint != nil {
		result.ModelsEndpoint = strings.TrimSpace(*file.ModelsEndpoint)
	}
	if file.DefaultEndpoint != nil {
		result.DefaultEndpoint = strings.TrimSpace(*file.DefaultEndpoint)
	}
	if file.DefaultAuth != nil {
		result.DefaultAuth = strings.TrimSpace(*file.DefaultAuth)
	}
	if file.DefaultEnabledModels != nil {
		result.DefaultEnabledModels = append([]string(nil), file.DefaultEnabledModels...)
	}
	if file.Capabilities != nil {
		result.Capabilities = append([]string(nil), file.Capabilities...)
	}
	if file.Aliases != nil {
		result.Aliases = append([]string(nil), file.Aliases...)
	}
	if file.SupportsClosedModels != nil {
		result.SupportsClosedModels = *file.SupportsClosedModels
	}
	if file.SupportsMultiVendorModels != nil {
		result.SupportsMultiVendorModels = *file.SupportsMultiVendorModels
	}
	if file.Protocols != nil {
		protocols, err := mergeTemplateProtocols(base.Protocols, file.Protocols)
		if err != nil {
			return Template{}, err
		}
		result.Protocols = protocols
	}
	if file.HideInChooser != nil {
		result.HideInChooser = *file.HideInChooser
	}
	if file.SkipTLSCertVerify != nil {
		result.SkipTLSCertVerify = *file.SkipTLSCertVerify
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

func mergeTemplateProtocols(base []TemplateProtocol, overrides []templateProtocolFile) ([]TemplateProtocol, error) {
	result := append([]TemplateProtocol(nil), base...)
	indexByID := make(map[string]int, len(result))
	for index, protocol := range result {
		indexByID[protocol.ID] = index
	}

	for _, override := range overrides {
		if strings.TrimSpace(override.ID) == "" {
			return nil, fmt.Errorf("template protocol id is required")
		}
		if index, ok := indexByID[override.ID]; ok {
			merged := applyProtocolOverlay(result[index], override)
			result[index] = merged
			continue
		}
		merged := applyProtocolOverlay(TemplateProtocol{ID: override.ID}, override)
		result = append(result, merged)
		indexByID[override.ID] = len(result) - 1
	}

	return result, nil
}

func applyProtocolOverlay(base TemplateProtocol, override templateProtocolFile) TemplateProtocol {
	result := base
	result.ID = strings.TrimSpace(override.ID)
	if override.Label != nil {
		result.Label = strings.TrimSpace(*override.Label)
	}
	if override.Default != nil {
		result.Default = *override.Default
	}
	if override.DefaultEndpoint != nil {
		result.DefaultEndpoint = strings.TrimSpace(*override.DefaultEndpoint)
	}
	if override.ModelsEndpoint != nil {
		result.ModelsEndpoint = strings.TrimSpace(*override.ModelsEndpoint)
	}
	if strings.TrimSpace(result.Label) == "" {
		result.Label = result.ID
	}
	return result
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
		result = append(result, merged)
		indexByID[override.ID] = len(result) - 1
	}

	return result, nil
}

func applyFieldOverlay(base TemplateField, override templateFieldFile) (TemplateField, error) {
	result := base
	result.ID = strings.TrimSpace(override.ID)
	if override.Label != nil {
		result.Label = strings.TrimSpace(*override.Label)
	}
	if override.Type != nil {
		result.Type = strings.TrimSpace(*override.Type)
	}
	if override.Required != nil {
		result.Required = *override.Required
	}
	if override.Advanced != nil {
		result.Advanced = *override.Advanced
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
	if override.HelpURL != nil {
		result.HelpURL = strings.TrimSpace(*override.HelpURL)
	}
	if override.HelpText != nil {
		result.HelpText = strings.TrimSpace(*override.HelpText)
	}
	if override.Default != nil {
		var decoded any
		if err := json.Unmarshal(override.Default, &decoded); err != nil {
			return TemplateField{}, fmt.Errorf("parse default for field %s: %w", result.ID, err)
		}
		result.Default = decoded
	}
	if strings.TrimSpace(result.Label) == "" {
		result.Label = result.ID
	}
	if strings.TrimSpace(result.Type) == "" {
		result.Type = defaultFieldType(result.ID)
	}
	return result, nil
}

func applyImplicitTemplateDefaults(template Template) Template {
	defaultEndpoint := strings.TrimSpace(template.DefaultEndpoint)
	if defaultEndpoint == "" {
		return template
	}

	if len(template.Protocols) > 0 {
		protocols := append([]TemplateProtocol(nil), template.Protocols...)
		for index, protocol := range protocols {
			if strings.TrimSpace(protocol.DefaultEndpoint) != "" {
				continue
			}
			protocol.DefaultEndpoint = defaultEndpoint
			protocols[index] = protocol
		}
		template.Protocols = protocols
	}

	if len(template.Fields) == 0 {
		return template
	}

	fields := append([]TemplateField(nil), template.Fields...)
	for index, field := range fields {
		if strings.TrimSpace(field.ID) != "endpoint" || field.Default != nil {
			continue
		}
		field.Default = defaultEndpoint
		fields[index] = field
	}
	template.Fields = fields
	return template
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
	if strings.TrimSpace(template.UIGroup) == "" {
		return fmt.Errorf("template uiGroup is required")
	}
	if !isAllowedTemplateValue(template.UIGroup, "single_provider", "cloud_gateway", "self_hosted") {
		return fmt.Errorf("template uiGroup must be single_provider, cloud_gateway, or self_hosted")
	}
	if strings.TrimSpace(template.HostingMode) == "" {
		return fmt.Errorf("template hostingMode is required")
	}
	if !isAllowedTemplateValue(template.HostingMode, "cloud", "self_hosted", "hybrid") {
		return fmt.Errorf("template hostingMode must be cloud, self_hosted, or hybrid")
	}
	if strings.TrimSpace(template.ServiceMode) == "" {
		return fmt.Errorf("template serviceMode is required")
	}
	if !isAllowedTemplateValue(template.ServiceMode, "official_provider", "maas_platform", "gateway", "inference_runtime", "compat_proxy") {
		return fmt.Errorf("template serviceMode must be official_provider, maas_platform, gateway, inference_runtime, or compat_proxy")
	}
	if strings.TrimSpace(template.EndpointMode) == "" {
		return fmt.Errorf("template endpointMode is required")
	}
	if !isAllowedTemplateValue(template.EndpointMode, "fixed", "customizable", "user_supplied") {
		return fmt.Errorf("template endpointMode must be fixed, customizable, or user_supplied")
	}
	if mode := strings.TrimSpace(template.ProviderMode); mode == "" {
		return fmt.Errorf("template providerMode is required")
	} else if mode != "vendor" && mode != "gateway" {
		return fmt.Errorf("template providerMode must be vendor or gateway")
	}
	defaultProtocols := 0
	for _, protocol := range template.Protocols {
		if strings.TrimSpace(protocol.ID) == "" {
			return fmt.Errorf("template protocol id is required")
		}
		if protocol.Default {
			defaultProtocols++
		}
	}
	if defaultProtocols > 1 {
		return fmt.Errorf("template protocols can define only one default")
	}
	seen := make(map[string]struct{}, len(template.Fields))
	for _, field := range template.Fields {
		if strings.TrimSpace(field.ID) == "" {
			return fmt.Errorf("template field id is required")
		}
		if _, exists := seen[field.ID]; exists {
			return fmt.Errorf("duplicate template field %q", field.ID)
		}
		seen[field.ID] = struct{}{}
	}
	return nil
}

func isAllowedTemplateValue(value string, allowed ...string) bool {
	normalized := strings.TrimSpace(value)
	for _, item := range allowed {
		if normalized == item {
			return true
		}
	}
	return false
}

func defaultFieldType(fieldID string) string {
	switch strings.TrimSpace(strings.ToLower(fieldID)) {
	case "credential":
		return "secret_ref"
	default:
		return "string"
	}
}
