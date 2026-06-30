package aiproviders

import (
	"strings"

	resourceshared "github.com/websoft9/appos/backend/domain/resource/shared"
)

const (
	KindLLM                  = "llm"
	TemplateOpenAICompatible = "generic-llm"
	TemplateGenericLLM       = TemplateOpenAICompatible
	AuthSchemeNone           = "none"
	AuthSchemeAPIKey         = "api_key"
	AuthSchemeBearer         = "bearer"
	AuthSchemeBasic          = "basic"
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

type AIProvider struct {
	id                string
	created           string
	updated           string
	name              string
	kind              string
	isEnabled         bool
	isDefault         bool
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
	IsDefault         bool
	TemplateID        string
	Endpoint          string
	AuthScheme        string
	ProviderAccountID string
	CredentialID      string
	Config            map[string]any
	Description       string
}

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
}

type TemplateProtocol struct {
	ID              string `json:"id"`
	Label           string `json:"label"`
	Default         bool   `json:"default,omitempty"`
	DefaultEndpoint string `json:"defaultEndpoint,omitempty"`
	ModelsEndpoint  string `json:"modelsEndpoint,omitempty"`
}

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
	DefaultAuth               string             `json:"defaultAuthScheme,omitempty"`
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

func AllowedKinds() []string {
	return []string{KindLLM}
}

func IsAllowedKind(kind string) bool {
	return kind == KindLLM
}

func NewAIProvider() *AIProvider {
	return &AIProvider{isEnabled: true, config: map[string]any{}}
}

func RestoreAIProvider(snapshot Snapshot) *AIProvider {
	return &AIProvider{
		id:                snapshot.ID,
		created:           snapshot.Created,
		updated:           snapshot.Updated,
		name:              snapshot.Name,
		kind:              snapshot.Kind,
		isEnabled:         snapshot.IsEnabled,
		isDefault:         snapshot.IsDefault,
		templateID:        snapshot.TemplateID,
		endpoint:          snapshot.Endpoint,
		authScheme:        snapshot.AuthScheme,
		providerAccountID: snapshot.ProviderAccountID,
		credentialID:      snapshot.CredentialID,
		config:            resourceshared.CloneMap(snapshot.Config),
		description:       snapshot.Description,
	}
}

func DecodeConfig(raw any) map[string]any {
	return resourceshared.DecodeConfig(raw)
}

func (p *AIProvider) ID() string                { return p.id }
func (p *AIProvider) Created() string           { return p.created }
func (p *AIProvider) Updated() string           { return p.updated }
func (p *AIProvider) Name() string              { return p.name }
func (p *AIProvider) Kind() string              { return p.kind }
func (p *AIProvider) IsEnabled() bool           { return p.isEnabled }
func (p *AIProvider) IsDefault() bool           { return p.isDefault }
func (p *AIProvider) TemplateID() string        { return p.templateID }
func (p *AIProvider) Endpoint() string          { return p.endpoint }
func (p *AIProvider) AuthScheme() string        { return p.authScheme }
func (p *AIProvider) ProviderAccountID() string { return p.providerAccountID }
func (p *AIProvider) CredentialID() string      { return p.credentialID }
func (p *AIProvider) Description() string       { return p.description }

func (p *AIProvider) Meta() resourceshared.RecordMeta {
	return resourceshared.RecordMeta{ID: p.id, Created: p.created, Updated: p.updated}
}

func (p *AIProvider) EnabledState() resourceshared.EnabledState {
	return resourceshared.EnabledState{IsEnabled: p.isEnabled}
}

func (p *AIProvider) Config() map[string]any {
	return resourceshared.CloneMap(p.config)
}

func (p *AIProvider) ApplySaveInput(input SaveInput) {
	p.name = strings.TrimSpace(input.Name)
	p.kind = strings.TrimSpace(input.Kind)
	p.isEnabled = input.IsEnabled
	p.isDefault = input.IsDefault
	p.templateID = strings.TrimSpace(input.TemplateID)
	p.endpoint = strings.TrimSpace(input.Endpoint)
	p.authScheme = strings.TrimSpace(input.AuthScheme)
	p.providerAccountID = strings.TrimSpace(input.ProviderAccountID)
	p.credentialID = strings.TrimSpace(input.CredentialID)
	p.config = resourceshared.CloneMap(input.Config)
	p.description = strings.TrimSpace(input.Description)
}

func (p *AIProvider) SetTemplateID(value string) {
	p.templateID = value
}

func (p *AIProvider) SetIsDefault(value bool) {
	p.isDefault = value
}

func (p *AIProvider) SetEndpoint(value string) {
	p.endpoint = value
}

func (p *AIProvider) SetAuthScheme(value string) {
	p.authScheme = value
}

func (p *AIProvider) EnsureConfig() {
	if p.config == nil {
		p.config = map[string]any{}
	}
}

func (p *AIProvider) Snapshot() Snapshot {
	return Snapshot{
		ID:                p.ID(),
		Created:           p.Created(),
		Updated:           p.Updated(),
		Name:              p.Name(),
		Kind:              p.Kind(),
		IsEnabled:         p.IsEnabled(),
		IsDefault:         p.IsDefault(),
		TemplateID:        p.TemplateID(),
		Endpoint:          p.Endpoint(),
		AuthScheme:        p.AuthScheme(),
		ProviderAccountID: p.ProviderAccountID(),
		CredentialID:      p.CredentialID(),
		Config:            p.Config(),
		Description:       p.Description(),
	}
}
