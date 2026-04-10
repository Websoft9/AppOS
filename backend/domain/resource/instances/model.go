package instances

import (
	"encoding/json"
	"strings"
)

const (
	KindMySQL    = "mysql"
	KindPostgres = "postgres"
	KindRedis    = "redis"
	KindKafka    = "kafka"
	KindS3       = "s3"
	KindRegistry = "registry"
	KindOllama   = "ollama"
)

var declaredKinds = []string{
	KindMySQL,
	KindPostgres,
	KindRedis,
	KindKafka,
	KindS3,
	KindRegistry,
	KindOllama,
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

// Instance is the canonical registration-only service dependency shape.
type Instance struct {
	id                string
	created           string
	updated           string
	name              string
	kind              string
	templateID        string
	endpoint          string
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
	TemplateID        string
	Endpoint          string
	ProviderAccountID string
	CredentialID      string
	Config            map[string]any
	Description       string
}

func NewInstance() *Instance {
	return &Instance{config: map[string]any{}}
}

func RestoreInstance(snapshot Snapshot) *Instance {
	return &Instance{
		id:                snapshot.ID,
		created:           snapshot.Created,
		updated:           snapshot.Updated,
		name:              snapshot.Name,
		kind:              snapshot.Kind,
		templateID:        snapshot.TemplateID,
		endpoint:          snapshot.Endpoint,
		providerAccountID: snapshot.ProviderAccountID,
		credentialID:      snapshot.CredentialID,
		config:            cloneMap(snapshot.Config),
		description:       snapshot.Description,
	}
}

func (i *Instance) ID() string                { return i.id }
func (i *Instance) Created() string           { return i.created }
func (i *Instance) Updated() string           { return i.updated }
func (i *Instance) Name() string              { return i.name }
func (i *Instance) Kind() string              { return i.kind }
func (i *Instance) TemplateID() string        { return i.templateID }
func (i *Instance) Endpoint() string          { return i.endpoint }
func (i *Instance) ProviderAccountID() string { return i.providerAccountID }
func (i *Instance) CredentialID() string      { return i.credentialID }
func (i *Instance) Description() string       { return i.description }

func (i *Instance) Config() map[string]any {
	return cloneMap(i.config)
}

func (i *Instance) ApplySaveInput(input SaveInput) {
	i.name = strings.TrimSpace(input.Name)
	i.kind = strings.TrimSpace(input.Kind)
	i.templateID = strings.TrimSpace(input.TemplateID)
	i.endpoint = strings.TrimSpace(input.Endpoint)
	i.providerAccountID = strings.TrimSpace(input.ProviderAccountID)
	i.credentialID = strings.TrimSpace(input.CredentialID)
	i.config = cloneMap(input.Config)
	i.description = strings.TrimSpace(input.Description)
}

func (i *Instance) SetTemplateID(value string) {
	i.templateID = value
}

func (i *Instance) SetEndpoint(value string) {
	i.endpoint = value
}

func (i *Instance) EnsureConfig() {
	if i.config == nil {
		i.config = map[string]any{}
	}
}

func (i *Instance) Snapshot() Snapshot {
	return Snapshot{
		ID:                i.ID(),
		Created:           i.Created(),
		Updated:           i.Updated(),
		Name:              i.Name(),
		Kind:              i.Kind(),
		TemplateID:        i.TemplateID(),
		Endpoint:          i.Endpoint(),
		ProviderAccountID: i.ProviderAccountID(),
		CredentialID:      i.CredentialID(),
		Config:            i.Config(),
		Description:       i.Description(),
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
	ID string `json:"id"`
	// Category is the product-facing directory group used for navigation and discovery.
	// It is not the resource identity axis; kind remains the canonical instance identity.
	Category         string          `json:"category,omitempty"`
	Kind             string          `json:"kind"`
	Title            string          `json:"title"`
	Vendor           string          `json:"vendor,omitempty"`
	Description      string          `json:"description,omitempty"`
	DefaultEndpoint  string          `json:"defaultEndpoint,omitempty"`
	OmitCommonFields []string        `json:"omitCommonFields,omitempty"`
	Fields           []TemplateField `json:"fields,omitempty"`
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
