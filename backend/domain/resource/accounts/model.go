package accounts

import (
	"encoding/json"
	"strings"
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

type ProviderAccount struct {
	id           string
	created      string
	updated      string
	name         string
	kind         string
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
	TemplateID   string
	Identifier   string
	CredentialID string
	Config       map[string]any
	Description  string
}

func NewProviderAccount() *ProviderAccount {
	return &ProviderAccount{config: map[string]any{}}
}

func RestoreProviderAccount(snapshot Snapshot) *ProviderAccount {
	return &ProviderAccount{
		id:           snapshot.ID,
		created:      snapshot.Created,
		updated:      snapshot.Updated,
		name:         snapshot.Name,
		kind:         snapshot.Kind,
		templateID:   snapshot.TemplateID,
		identifier:   snapshot.Identifier,
		credentialID: snapshot.CredentialID,
		config:       cloneMap(snapshot.Config),
		description:  snapshot.Description,
	}
}

func (p *ProviderAccount) ID() string           { return p.id }
func (p *ProviderAccount) Created() string      { return p.created }
func (p *ProviderAccount) Updated() string      { return p.updated }
func (p *ProviderAccount) Name() string         { return p.name }
func (p *ProviderAccount) Kind() string         { return p.kind }
func (p *ProviderAccount) TemplateID() string   { return p.templateID }
func (p *ProviderAccount) Identifier() string   { return p.identifier }
func (p *ProviderAccount) CredentialID() string { return p.credentialID }
func (p *ProviderAccount) Description() string  { return p.description }

func (p *ProviderAccount) Config() map[string]any {
	return cloneMap(p.config)
}

func (p *ProviderAccount) ApplySaveInput(input SaveInput) {
	p.name = strings.TrimSpace(input.Name)
	p.kind = strings.TrimSpace(input.Kind)
	p.templateID = strings.TrimSpace(input.TemplateID)
	p.identifier = strings.TrimSpace(input.Identifier)
	p.credentialID = strings.TrimSpace(input.CredentialID)
	p.config = cloneMap(input.Config)
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
		output[key] = cloneValue(value)
	}
	return output
}

func cloneValue(v any) any {
	switch val := v.(type) {
	case map[string]any:
		return cloneMap(val)
	case []any:
		clone := make([]any, len(val))
		for i, item := range val {
			clone[i] = cloneValue(item)
		}
		return clone
	default:
		return v
	}
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

	var decoded map[string]any
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		return map[string]any{}
	}
	return cloneMap(decoded)
}
