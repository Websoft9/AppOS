package connectors

import (
	"strings"

	resourceshared "github.com/websoft9/appos/backend/domain/resource/shared"
)

const (
	KindLLM         = "llm"
	KindRESTAPI     = "rest_api"
	KindWebhook     = "webhook"
	KindMCP         = "mcp"
	KindHTTPGateway = "http-gateway"
	KindSMTP        = "smtp"
	KindDNS         = "dns"
	KindRegistry    = "registry"
	KindProxy       = "proxy"
)

const (
	TemplateGenericLLM = "generic-llm"
)

var declaredKinds = []string{
	KindLLM,
	KindRESTAPI,
	KindWebhook,
	KindMCP,
	KindHTTPGateway,
	KindSMTP,
	KindDNS,
	KindRegistry,
	KindProxy,
}

func AllowedKinds() []string {
	result := make([]string, len(declaredKinds))
	copy(result, declaredKinds)
	return result
}

func IsAllowedKind(kind string) bool {
	for _, item := range declaredKinds {
		if item == strings.TrimSpace(kind) {
			return true
		}
	}
	return false
}

func IsLLMKind(kind string) bool {
	return strings.TrimSpace(kind) == KindLLM
}

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
	"provider_account",
	"credential",
	"config",
	"description",
}

// Connector is the canonical resource shape for reusable external capability access.
type Connector struct {
	id                string
	created           string
	updated           string
	name              string
	kind              string
	isEnabled         bool
	templateID        string
	endpoint          string
	authScheme        string
	providerAccountID string
	credentialID      string
	config            map[string]any
	description       string
}

type Snapshot struct {
	ID                string
	Created           string
	Updated           string
	Name              string
	Kind              string
	IsEnabled         bool
	TemplateID        string
	Endpoint          string
	AuthScheme        string
	ProviderAccountID string
	CredentialID      string
	Config            map[string]any
	Description       string
}

func NewConnector() *Connector {
	return &Connector{isEnabled: true, config: map[string]any{}}
}

func RestoreConnector(snapshot Snapshot) *Connector {
	return &Connector{
		id:                snapshot.ID,
		created:           snapshot.Created,
		updated:           snapshot.Updated,
		name:              snapshot.Name,
		kind:              snapshot.Kind,
		isEnabled:         snapshot.IsEnabled,
		templateID:        snapshot.TemplateID,
		endpoint:          snapshot.Endpoint,
		authScheme:        snapshot.AuthScheme,
		providerAccountID: snapshot.ProviderAccountID,
		credentialID:      snapshot.CredentialID,
		config:            resourceshared.CloneMap(snapshot.Config),
		description:       snapshot.Description,
	}
}

func (c *Connector) ID() string                { return c.id }
func (c *Connector) Created() string           { return c.created }
func (c *Connector) Updated() string           { return c.updated }
func (c *Connector) Name() string              { return c.name }
func (c *Connector) Kind() string              { return c.kind }
func (c *Connector) IsEnabled() bool           { return c.isEnabled }
func (c *Connector) TemplateID() string        { return c.templateID }
func (c *Connector) Endpoint() string          { return c.endpoint }
func (c *Connector) AuthScheme() string        { return c.authScheme }
func (c *Connector) ProviderAccountID() string { return c.providerAccountID }
func (c *Connector) CredentialID() string      { return c.credentialID }
func (c *Connector) Description() string       { return c.description }

func (c *Connector) Meta() resourceshared.RecordMeta {
	return resourceshared.RecordMeta{ID: c.id, Created: c.created, Updated: c.updated}
}

func (c *Connector) EnabledState() resourceshared.EnabledState {
	return resourceshared.EnabledState{IsEnabled: c.isEnabled}
}

func (c *Connector) Config() map[string]any {
	return resourceshared.CloneMap(c.config)
}

func (c *Connector) ApplySaveInput(input SaveInput) {
	c.name = strings.TrimSpace(input.Name)
	c.kind = strings.TrimSpace(input.Kind)
	c.isEnabled = input.IsEnabled
	c.templateID = strings.TrimSpace(input.TemplateID)
	c.endpoint = strings.TrimSpace(input.Endpoint)
	c.authScheme = strings.TrimSpace(input.AuthScheme)
	c.providerAccountID = strings.TrimSpace(input.ProviderAccountID)
	c.credentialID = strings.TrimSpace(input.CredentialID)
	c.config = resourceshared.CloneMap(input.Config)
	c.description = strings.TrimSpace(input.Description)
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
		ID:                c.ID(),
		Created:           c.Created(),
		Updated:           c.Updated(),
		Name:              c.Name(),
		Kind:              c.Kind(),
		IsEnabled:         c.IsEnabled(),
		TemplateID:        c.TemplateID(),
		Endpoint:          c.Endpoint(),
		AuthScheme:        c.AuthScheme(),
		ProviderAccountID: c.ProviderAccountID(),
		CredentialID:      c.CredentialID(),
		Config:            c.Config(),
		Description:       c.Description(),
	}
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
	HelpURL        string `json:"helpUrl,omitempty"`
	HelpText       string `json:"helpText,omitempty"`
	Default        any    `json:"default,omitempty"`
	Options        []TemplateFieldOption  `json:"options,omitempty"`
	ShowWhen       *TemplateFieldShowWhen `json:"showWhen,omitempty"`
}

type TemplateFieldOption struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

type TemplateFieldShowWhen struct {
	Field  string   `json:"field"`
	Values []string `json:"values,omitempty"`
}

type TemplateProtocol struct {
	ID              string `json:"id"`
	Label           string `json:"label"`
	Default         bool   `json:"default,omitempty"`
	DefaultEndpoint string `json:"defaultEndpoint,omitempty"`
	ModelsEndpoint  string `json:"modelsEndpoint,omitempty"`
}

// Template is the minimum connector template contract loaded from built-in defaults and template files.
// ID is a profile identifier within a kind. It may be vendor-specific (for example openai)
// or generic (for example generic-smtp), depending on how much differentiation the kind needs.
type Template struct {
	ID                        string             `json:"id"`
	Kind                      string             `json:"kind"`
	Title                     string             `json:"title"`
	Vendor                    string             `json:"vendor,omitempty"`
	Category                  string             `json:"category,omitempty"`
	UIGroup                   string             `json:"uiGroup,omitempty"`
	HostingMode               string             `json:"hostingMode,omitempty"`
	ServiceMode               string             `json:"serviceMode,omitempty"`
	EndpointMode              string             `json:"endpointMode,omitempty"`
	ProviderMode              string             `json:"providerMode,omitempty"`
	Description               string             `json:"description,omitempty"`
	HelpURL                   string             `json:"helpUrl,omitempty"`
	ContextSize               int                `json:"contextSize,omitempty"`
	ModelsEndpoint            string             `json:"modelsEndpoint,omitempty"`
	DefaultEndpoint           string             `json:"defaultEndpoint,omitempty"`
	DefaultEndpointTLS        string             `json:"defaultEndpointTls,omitempty"`
	DefaultAuth               string             `json:"defaultAuthScheme,omitempty"`
	AuthPresentation          string             `json:"authPresentation,omitempty"`
	EndpointShape             string             `json:"endpointShape,omitempty"`
	EndpointScheme            string             `json:"endpointScheme,omitempty"`
	DefaultEnabledModels      []string           `json:"defaultEnabledModels,omitempty"`
	Capabilities              []string           `json:"capabilities,omitempty"`
	Aliases                   []string           `json:"aliases,omitempty"`
	SupportsClosedModels      bool               `json:"supportsClosedModels,omitempty"`
	SupportsMultiVendorModels bool               `json:"supportsMultiVendorModels,omitempty"`
	Protocols                 []TemplateProtocol `json:"protocols,omitempty"`
	HideInChooser             bool               `json:"hideInChooser,omitempty"`
	SkipTLSCertVerify         bool               `json:"skipTLSCertVerify,omitempty"`
	Fields                    []TemplateField    `json:"fields,omitempty"`
}

func NormalizeTemplateID(raw string) string { return resourceshared.NormalizeTemplateID(raw) }

func DecodeConfig(raw any) map[string]any { return resourceshared.DecodeConfig(raw) }
