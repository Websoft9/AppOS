package connectors

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

const Collection = "connectors"

const (
	KindLLM      = "llm"
	KindRESTAPI  = "rest_api"
	KindWebhook  = "webhook"
	KindMCP      = "mcp"
	KindSMTP     = "smtp"
	KindDNS      = "dns"
	KindRegistry = "registry"
)

const (
	TemplateAnthropic   = "anthropic"
	TemplateGemini      = "google-gemini"
	TemplateMistral     = "mistral"
	TemplateDeepSeek    = "deepseek"
	TemplateGroq        = "groq"
	TemplateOpenRouter  = "openrouter"
	TemplateAzureOpenAI = "azure-openai"
	TemplateOllama      = "ollama"
	TemplateCustomLLM   = "custom-llm"

	TemplateGenericREST    = "generic-rest"
	TemplateGenericWebhook = "generic-webhook"
	TemplateGenericMCP     = "generic-mcp"
)

const (
	AuthSchemeNone   = "none"
	AuthSchemeAPIKey = "api_key"
	AuthSchemeBearer = "bearer"
	AuthSchemeBasic  = "basic"
)

var EditableFields = []string{
	"name",
	"kind",
	"template_id",
	"endpoint",
	"auth_scheme",
	"credential",
	"config",
	"description",
}

// Connector is the canonical resource shape for reusable external capability access.
type Connector struct {
	rec *core.Record
}

func From(rec *core.Record) *Connector {
	return &Connector{rec: rec}
}

func (c *Connector) Record() *core.Record { return c.rec }
func (c *Connector) ID() string           { return c.rec.Id }
func (c *Connector) Name() string         { return c.rec.GetString("name") }
func (c *Connector) Kind() string         { return c.rec.GetString("kind") }
func (c *Connector) TemplateID() string   { return c.rec.GetString("template_id") }
func (c *Connector) Endpoint() string     { return c.rec.GetString("endpoint") }
func (c *Connector) AuthScheme() string   { return c.rec.GetString("auth_scheme") }
func (c *Connector) CredentialID() string { return c.rec.GetString("credential") }
func (c *Connector) Description() string  { return c.rec.GetString("description") }

func (c *Connector) Config() map[string]any {
	raw := c.rec.Get("config")
	if config, ok := raw.(map[string]any); ok {
		return cloneMap(config)
	}
	return map[string]any{}
}

// Spec is the minimum transport-neutral connector shape used by migration and mapping code.
type Spec struct {
	Name         string
	Kind         string
	TemplateID   string
	Endpoint     string
	AuthScheme   string
	CredentialID string
	Config       map[string]any
	Description  string
}

// TemplateField describes one form/config field exposed by a connector template.
type TemplateField struct {
	ID             string `json:"id"`
	Label          string `json:"label"`
	Type           string `json:"type"`
	Required       bool   `json:"required,omitempty"`
	Sensitive      bool   `json:"sensitive,omitempty"`
	SecretTemplate string `json:"secretTemplate,omitempty"`
	Placeholder    string `json:"placeholder,omitempty"`
	HelpText       string `json:"helpText,omitempty"`
	Default        any    `json:"default,omitempty"`
}

// Template is the minimum connector template contract loaded from built-in defaults and template files.
type Template struct {
	ID              string          `json:"id"`
	Kind            string          `json:"kind"`
	Title           string          `json:"title"`
	Vendor          string          `json:"vendor,omitempty"`
	Category        string          `json:"category,omitempty"`
	Description     string          `json:"description,omitempty"`
	DefaultEndpoint string          `json:"defaultEndpoint,omitempty"`
	DefaultAuth     string          `json:"defaultAuthScheme,omitempty"`
	Capabilities    []string        `json:"capabilities,omitempty"`
	Aliases         []string        `json:"aliases,omitempty"`
	Fields          []TemplateField `json:"fields,omitempty"`
}

func NormalizeTemplateID(raw string) string {
	trimmed := strings.TrimSpace(strings.ToLower(raw))
	trimmed = strings.ReplaceAll(trimmed, "_", "-")
	trimmed = strings.ReplaceAll(trimmed, " ", "-")
	return trimmed
}

func cloneMap(input map[string]any) map[string]any {
	if input == nil {
		return map[string]any{}
	}
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}