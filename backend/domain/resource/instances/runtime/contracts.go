package runtime

import (
	"strings"

	resourceshared "github.com/websoft9/appos/backend/domain/resource/shared"
)

const (
	CapabilityCredentialProbeRedis = "credential_probe_redis"
)

type KindContract struct {
	Kind             string   `json:"kind"`
	Category         string   `json:"category"`
	Traits           []string `json:"traits,omitempty"`
	DefaultProbePort int      `json:"defaultProbePort,omitempty"`
}

var declaredKindContracts = []KindContract{
	{Kind: "mysql-compatible", Category: "database", Traits: []string{"relational", "sql"}, DefaultProbePort: 3306},
	{Kind: "postgres-compatible", Category: "database", Traits: []string{"relational", "sql"}, DefaultProbePort: 5432},
	{Kind: "mongodb-compatible", Category: "database", Traits: []string{"document", "nosql"}, DefaultProbePort: 27017},
	{Kind: "clickhouse-compatible", Category: "database", Traits: []string{"analytical", "sql", "columnar"}, DefaultProbePort: 8123},
	{Kind: "neo4j-compatible", Category: "database", Traits: []string{"graph"}, DefaultProbePort: 7687},
	{Kind: "influxdb-compatible", Category: "database", Traits: []string{"timeseries"}, DefaultProbePort: 8086},
	{Kind: "redis-compatible", Category: "cache", Traits: []string{"cache", "kv"}, DefaultProbePort: 6379},
	{Kind: "elasticsearch-compatible", Category: "search", Traits: []string{"search", "index"}, DefaultProbePort: 9200},
	{Kind: "kafka-compatible", Category: "message-queue", Traits: []string{"pubsub", "streaming"}, DefaultProbePort: 9092},
	{Kind: "amqp-compatible", Category: "message-queue", Traits: []string{"pubsub", "queue"}, DefaultProbePort: 5672},
	{Kind: "nats-compatible", Category: "message-queue", Traits: []string{"pubsub", "lightweight"}, DefaultProbePort: 4222},
	{Kind: "mqtt-compatible", Category: "message-queue", Traits: []string{"pubsub", "iot"}, DefaultProbePort: 1883},
	{Kind: "s3-compatible", Category: "storage", Traits: []string{"object-storage"}},
	{Kind: "onlyoffice-compatible", Category: "application-service", Traits: []string{"document", "editor", "collaboration"}},
}

func KindContracts() []KindContract {
	result := make([]KindContract, 0, len(declaredKindContracts))
	for _, contract := range declaredKindContracts {
		result = append(result, KindContract{
			Kind:             contract.Kind,
			Category:         contract.Category,
			Traits:           resourceshared.CloneStrings(contract.Traits),
			DefaultProbePort: contract.DefaultProbePort,
		})
	}
	return result
}

func FindKindContract(kind string) (KindContract, bool) {
	normalized := strings.TrimSpace(kind)
	for _, contract := range declaredKindContracts {
		if contract.Kind == normalized {
			return KindContract{
				Kind:             contract.Kind,
				Category:         contract.Category,
				Traits:           resourceshared.CloneStrings(contract.Traits),
				DefaultProbePort: contract.DefaultProbePort,
			}, true
		}
	}
	return KindContract{}, false
}

func ResolveTraits(kind string, templateID string, templateTraits func(string) ([]string, error)) ([]string, error) {
	traits := []string{}
	if contract, ok := FindKindContract(kind); ok {
		traits = append(traits, contract.Traits...)
	}
	if templateTraits != nil {
		normalizedTemplateID := resourceshared.NormalizeTemplateID(templateID)
		if normalizedTemplateID != "" {
			resolved, err := templateTraits(normalizedTemplateID)
			if err != nil {
				return nil, err
			}
			traits = append(traits, resolved...)
		}
	}
	return resourceshared.NormalizeStringList(traits), nil
}

func ResolveCapabilitiesFromTraits(traits []string) []string {
	normalizedTraits := resourceshared.NormalizeStringList(traits)
	if len(normalizedTraits) == 0 {
		return nil
	}
	capabilities := []string{}
	if resourceshared.ContainsString(normalizedTraits, "cache") && resourceshared.ContainsString(normalizedTraits, "kv") {
		capabilities = append(capabilities, CapabilityCredentialProbeRedis)
	}
	return resourceshared.NormalizeStringList(capabilities)
}
