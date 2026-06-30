package accounts

import (
	"strings"

	"github.com/websoft9/appos/backend/domain/resource/connectors"
	resourceshared "github.com/websoft9/appos/backend/domain/resource/shared"
)

const (
	KindAWS        = "aws"
	KindAliyun     = "aliyun"
	KindAzure      = "azure"
	KindGCP        = "gcp"
	KindGitHub     = "github"
	KindCloudflare = "cloudflare"
)

var declaredKinds = []string{
	KindAWS,
	KindAliyun,
	KindAzure,
	KindGCP,
	KindGitHub,
	KindCloudflare,
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

func IsConnectorKindIgnoredForReference(kind string) bool {
	return connectors.IsLLMKind(kind)
}

type ProviderAccount struct {
	id           string
	created      string
	updated      string
	name         string
	kind         string
	isEnabled    bool
	templateID   string
	identifier   string
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
	IsEnabled    bool
	TemplateID   string
	Identifier   string
	CredentialID string
	Config       map[string]any
	Description  string
}

func NewProviderAccount() *ProviderAccount {
	return &ProviderAccount{isEnabled: true, config: map[string]any{}}
}

func RestoreProviderAccount(snapshot Snapshot) *ProviderAccount {
	return &ProviderAccount{
		id:           snapshot.ID,
		created:      snapshot.Created,
		updated:      snapshot.Updated,
		name:         snapshot.Name,
		kind:         snapshot.Kind,
		isEnabled:    snapshot.IsEnabled,
		templateID:   snapshot.TemplateID,
		identifier:   snapshot.Identifier,
		credentialID: snapshot.CredentialID,
		config:       resourceshared.CloneMap(snapshot.Config),
		description:  snapshot.Description,
	}
}

func (p *ProviderAccount) ID() string           { return p.id }
func (p *ProviderAccount) Created() string      { return p.created }
func (p *ProviderAccount) Updated() string      { return p.updated }
func (p *ProviderAccount) Name() string         { return p.name }
func (p *ProviderAccount) Kind() string         { return p.kind }
func (p *ProviderAccount) IsEnabled() bool      { return p.isEnabled }
func (p *ProviderAccount) TemplateID() string   { return p.templateID }
func (p *ProviderAccount) Identifier() string   { return p.identifier }
func (p *ProviderAccount) CredentialID() string { return p.credentialID }
func (p *ProviderAccount) Description() string  { return p.description }

func (p *ProviderAccount) Meta() resourceshared.RecordMeta {
	return resourceshared.RecordMeta{ID: p.id, Created: p.created, Updated: p.updated}
}

func (p *ProviderAccount) EnabledState() resourceshared.EnabledState {
	return resourceshared.EnabledState{IsEnabled: p.isEnabled}
}

func (p *ProviderAccount) Config() map[string]any {
	return resourceshared.CloneMap(p.config)
}

func (p *ProviderAccount) ApplySaveInput(input SaveInput) {
	p.name = strings.TrimSpace(input.Name)
	p.kind = strings.TrimSpace(input.Kind)
	p.isEnabled = input.IsEnabled
	p.templateID = strings.TrimSpace(input.TemplateID)
	p.identifier = strings.TrimSpace(input.Identifier)
	p.credentialID = strings.TrimSpace(input.CredentialID)
	p.config = resourceshared.CloneMap(input.Config)
	p.description = strings.TrimSpace(input.Description)
}

func (p *ProviderAccount) SetTemplateID(value string) {
	p.templateID = value
}

func (p *ProviderAccount) EnsureConfig() {
	if p.config == nil {
		p.config = map[string]any{}
	}
}

func (p *ProviderAccount) Snapshot() Snapshot {
	return Snapshot{
		ID:           p.ID(),
		Created:      p.Created(),
		Updated:      p.Updated(),
		Name:         p.Name(),
		Kind:         p.Kind(),
		IsEnabled:    p.IsEnabled(),
		TemplateID:   p.TemplateID(),
		Identifier:   p.Identifier(),
		CredentialID: p.CredentialID(),
		Config:       p.Config(),
		Description:  p.Description(),
	}
}

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

type Template struct {
	ID          string          `json:"id"`
	Category    string          `json:"category,omitempty"`
	Kind        string          `json:"kind"`
	Title       string          `json:"title"`
	Vendor      string          `json:"vendor,omitempty"`
	Description string          `json:"description,omitempty"`
	Fields      []TemplateField `json:"fields,omitempty"`
}

func NormalizeTemplateID(raw string) string { return resourceshared.NormalizeTemplateID(raw) }

func DecodeConfig(raw any) map[string]any { return resourceshared.DecodeConfig(raw) }
