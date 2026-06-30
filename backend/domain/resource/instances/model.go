package instances

import (
	"strings"

	resourceshared "github.com/websoft9/appos/backend/domain/resource/shared"
)

const (
	KindMySQLCompatible         = "mysql-compatible"
	KindPostgresCompatible      = "postgres-compatible"
	KindMongoDBCompatible       = "mongodb-compatible"
	KindClickHouseCompatible    = "clickhouse-compatible"
	KindNeo4jCompatible         = "neo4j-compatible"
	KindInfluxDBCompatible      = "influxdb-compatible"
	KindRedisCompatible         = "redis-compatible"
	KindElasticsearchCompatible = "elasticsearch-compatible"
	KindKafkaCompatible         = "kafka-compatible"
	KindAMQPCompatible          = "amqp-compatible"
	KindNATSCompatible          = "nats-compatible"
	KindMQTTCompatible          = "mqtt-compatible"
	KindS3Compatible            = "s3-compatible"
	KindOnlyOfficeCompatible    = "onlyoffice-compatible"
)

func AllowedKinds() []string {
	contracts := KindContracts()
	result := make([]string, 0, len(contracts))
	for _, contract := range contracts {
		result = append(result, contract.Kind)
	}
	return result
}

func IsAllowedKind(kind string) bool {
	_, ok := FindKindContract(kind)
	return ok
}

// Instance is the canonical registration-only service dependency shape.
type Instance struct {
	id                string
	created           string
	updated           string
	name              string
	kind              string
	isEnabled         bool
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
	IsEnabled         bool
	TemplateID        string
	Endpoint          string
	ProviderAccountID string
	CredentialID      string
	Config            map[string]any
	Description       string
}

func NewInstance() *Instance {
	return &Instance{isEnabled: true, config: map[string]any{}}
}

func RestoreInstance(snapshot Snapshot) *Instance {
	return &Instance{
		id:                snapshot.ID,
		created:           snapshot.Created,
		updated:           snapshot.Updated,
		name:              snapshot.Name,
		kind:              snapshot.Kind,
		isEnabled:         snapshot.IsEnabled,
		templateID:        snapshot.TemplateID,
		endpoint:          snapshot.Endpoint,
		providerAccountID: snapshot.ProviderAccountID,
		credentialID:      snapshot.CredentialID,
		config:            resourceshared.CloneMap(snapshot.Config),
		description:       snapshot.Description,
	}
}

func (i *Instance) ID() string                { return i.id }
func (i *Instance) Created() string           { return i.created }
func (i *Instance) Updated() string           { return i.updated }
func (i *Instance) Name() string              { return i.name }
func (i *Instance) Kind() string              { return i.kind }
func (i *Instance) IsEnabled() bool           { return i.isEnabled }
func (i *Instance) TemplateID() string        { return i.templateID }
func (i *Instance) Endpoint() string          { return i.endpoint }
func (i *Instance) ProviderAccountID() string { return i.providerAccountID }
func (i *Instance) CredentialID() string      { return i.credentialID }
func (i *Instance) Description() string       { return i.description }

func (i *Instance) Meta() resourceshared.RecordMeta {
	return resourceshared.RecordMeta{ID: i.id, Created: i.created, Updated: i.updated}
}

func (i *Instance) EnabledState() resourceshared.EnabledState {
	return resourceshared.EnabledState{IsEnabled: i.isEnabled}
}

func (i *Instance) Config() map[string]any {
	return resourceshared.CloneMap(i.config)
}

func (i *Instance) ApplySaveInput(input SaveInput) {
	i.name = strings.TrimSpace(input.Name)
	i.kind = strings.TrimSpace(input.Kind)
	i.isEnabled = input.IsEnabled
	i.templateID = strings.TrimSpace(input.TemplateID)
	i.endpoint = strings.TrimSpace(input.Endpoint)
	i.providerAccountID = strings.TrimSpace(input.ProviderAccountID)
	i.credentialID = strings.TrimSpace(input.CredentialID)
	i.config = resourceshared.CloneMap(input.Config)
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
		IsEnabled:         i.IsEnabled(),
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
	Category            string          `json:"category,omitempty"`
	Kind                string          `json:"kind"`
	Traits              []string        `json:"traits,omitempty"`
	Title               string          `json:"title"`
	Vendor              string          `json:"vendor,omitempty"`
	Description         string          `json:"description,omitempty"`
	DefaultEndpoint     string          `json:"defaultEndpoint,omitempty"`
	OmitCommonFields    []string        `json:"omitCommonFields,omitempty"`
	CommonFieldDefaults map[string]any  `json:"commonFieldDefaults,omitempty"`
	Fields              []TemplateField `json:"fields,omitempty"`
}

func NormalizeTemplateID(raw string) string { return resourceshared.NormalizeTemplateID(raw) }

func DecodeConfig(raw any) map[string]any { return resourceshared.DecodeConfig(raw) }
