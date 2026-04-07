package connectors

import (
	"encoding/json"
	"strings"
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
	TemplateGenericLLM = "generic-llm"
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
	"is_default",
	"template_id",
	"endpoint",
	"auth_scheme",
	"credential",
	"config",
	"description",
}

// Connector is the canonical resource shape for reusable external capability access.
type Connector struct {
	id           string
	created      string
	updated      string
	name         string
	kind         string
	isDefault    bool
	templateID   string
	endpoint     string
	authScheme   string
	credentialID string
	config       map[string]any
	description  string
}

type Snapshot struct {
	ID           string
	Created      string
	Updated      string
	Name         string
	Kind         string
	IsDefault    bool
	TemplateID   string
	Endpoint     string
	AuthScheme   string
	CredentialID string
	Config       map[string]any
	Description  string
}

func NewConnector() *Connector {
	return &Connector{config: map[string]any{}}
}

func RestoreConnector(snapshot Snapshot) *Connector {
	return &Connector{
		id:           snapshot.ID,
		created:      snapshot.Created,
		updated:      snapshot.Updated,
		name:         snapshot.Name,
		kind:         snapshot.Kind,
		isDefault:    snapshot.IsDefault,
		templateID:   snapshot.TemplateID,
		endpoint:     snapshot.Endpoint,
		authScheme:   snapshot.AuthScheme,
		credentialID: snapshot.CredentialID,
		config:       cloneMap(snapshot.Config),
		description:  snapshot.Description,
	}
}

func (c *Connector) ID() string           { return c.id }
func (c *Connector) Created() string      { return c.created }
func (c *Connector) Updated() string      { return c.updated }
func (c *Connector) Name() string         { return c.name }
func (c *Connector) Kind() string         { return c.kind }
func (c *Connector) IsDefault() bool      { return c.isDefault }
func (c *Connector) TemplateID() string   { return c.templateID }
func (c *Connector) Endpoint() string     { return c.endpoint }
func (c *Connector) AuthScheme() string   { return c.authScheme }
func (c *Connector) CredentialID() string { return c.credentialID }
func (c *Connector) Description() string  { return c.description }

func (c *Connector) Config() map[string]any {
	return cloneMap(c.config)
}

func (c *Connector) ApplySaveInput(input SaveInput) {
	c.name = strings.TrimSpace(input.Name)
	c.kind = strings.TrimSpace(input.Kind)
	c.isDefault = input.IsDefault
	c.templateID = strings.TrimSpace(input.TemplateID)
	c.endpoint = strings.TrimSpace(input.Endpoint)
	c.authScheme = strings.TrimSpace(input.AuthScheme)
	c.credentialID = strings.TrimSpace(input.CredentialID)
	c.config = cloneMap(input.Config)
	c.description = strings.TrimSpace(input.Description)
}

func (c *Connector) SetIsDefault(value bool) {
	c.isDefault = value
}

func (c *Connector) SetTemplateID(value string) {
	c.templateID = value
}

func (c *Connector) SetEndpoint(value string) {
	c.endpoint = value
}

func (c *Connector) SetAuthScheme(value string) {
	c.authScheme = value
}

func (c *Connector) EnsureConfig() {
	if c.config == nil {
		c.config = map[string]any{}
	}
}

func (c *Connector) Snapshot() Snapshot {
	return Snapshot{
		ID:           c.ID(),
		Created:      c.Created(),
		Updated:      c.Updated(),
		Name:         c.Name(),
		Kind:         c.Kind(),
		IsDefault:    c.IsDefault(),
		TemplateID:   c.TemplateID(),
		Endpoint:     c.Endpoint(),
		AuthScheme:   c.AuthScheme(),
		CredentialID: c.CredentialID(),
		Config:       c.Config(),
		Description:  c.Description(),
	}
}

func (c *Connector) ResponseMap() map[string]any {
	return map[string]any{
		"id":          c.ID(),
		"created":     c.Created(),
		"updated":     c.Updated(),
		"name":        c.Name(),
		"kind":        c.Kind(),
		"is_default":  c.IsDefault(),
		"template_id": c.TemplateID(),
		"endpoint":    c.Endpoint(),
		"auth_scheme": c.AuthScheme(),
		"credential":  c.CredentialID(),
		"config":      c.Config(),
		"description": c.Description(),
	}
}

// Spec is the minimum transport-neutral connector shape used by migration and mapping code.
// TemplateID stores a profile ID under a connector kind, not a separate top-level resource type.
type Spec struct {
	Name         string
	Kind         string
	IsDefault    bool
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
// ID is a profile identifier within a kind. It may be vendor-specific (for example openai)
// or generic (for example generic-smtp), depending on how much differentiation the kind needs.
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

func DecodeConfig(raw any) map[string]any {
	if config, ok := raw.(map[string]any); ok {
		return cloneMap(config)
	}
	if raw == nil {
		return map[string]any{}
	}

	var bytes []byte
	switch typed := raw.(type) {
	case []byte:
		bytes = typed
	case string:
		bytes = []byte(typed)
	default:
		marshaled, err := json.Marshal(typed)
		if err != nil {
			return map[string]any{}
		}
		bytes = marshaled
	}

	var config map[string]any
	if err := json.Unmarshal(bytes, &config); err != nil || config == nil {
		return map[string]any{}
	}
	return cloneMap(config)
}
