package instances

import "strings"

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
	{Kind: KindMySQLCompatible, Category: "database", Traits: []string{"relational", "sql"}, DefaultProbePort: 3306},
	{Kind: KindPostgresCompatible, Category: "database", Traits: []string{"relational", "sql"}, DefaultProbePort: 5432},
	{Kind: KindMongoDBCompatible, Category: "database", Traits: []string{"document", "nosql"}, DefaultProbePort: 27017},
	{Kind: KindClickHouseCompatible, Category: "database", Traits: []string{"analytical", "sql", "columnar"}, DefaultProbePort: 8123},
	{Kind: KindNeo4jCompatible, Category: "database", Traits: []string{"graph"}, DefaultProbePort: 7687},
	{Kind: KindInfluxDBCompatible, Category: "database", Traits: []string{"timeseries"}, DefaultProbePort: 8086},
	{Kind: KindRedisCompatible, Category: "cache", Traits: []string{"cache", "kv"}, DefaultProbePort: 6379},
	{Kind: KindElasticsearchCompatible, Category: "search", Traits: []string{"search", "index"}, DefaultProbePort: 9200},
	{Kind: KindKafkaCompatible, Category: "message-queue", Traits: []string{"pubsub", "streaming"}, DefaultProbePort: 9092},
	{Kind: KindAMQPCompatible, Category: "message-queue", Traits: []string{"pubsub", "queue"}, DefaultProbePort: 5672},
	{Kind: KindNATSCompatible, Category: "message-queue", Traits: []string{"pubsub", "lightweight"}, DefaultProbePort: 4222},
	{Kind: KindMQTTCompatible, Category: "message-queue", Traits: []string{"pubsub", "iot"}, DefaultProbePort: 1883},
	{Kind: KindS3Compatible, Category: "storage", Traits: []string{"object-storage"}},
	{Kind: KindOnlyOfficeCompatible, Category: "application-service", Traits: []string{"document", "editor", "collaboration"}},
}

func KindContracts() []KindContract {
	result := make([]KindContract, 0, len(declaredKindContracts))
	for _, contract := range declaredKindContracts {
		result = append(result, KindContract{
			Kind:             contract.Kind,
			Category:         contract.Category,
			Traits:           cloneStrings(contract.Traits),
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
				Traits:           cloneStrings(contract.Traits),
				DefaultProbePort: contract.DefaultProbePort,
			}, true
		}
	}
	return KindContract{}, false
}

func ResolveTraits(item *Instance) ([]string, error) {
	if item == nil {
		return nil, nil
	}
	traits := []string{}
	if contract, ok := FindKindContract(item.Kind()); ok {
		traits = append(traits, contract.Traits...)
	}
	if templateID := NormalizeTemplateID(item.TemplateID()); templateID != "" {
		template, ok, err := FindTemplate(templateID)
		if err != nil {
			return nil, err
		}
		if ok {
			traits = append(traits, template.Traits...)
		}
	}
	return normalizeStringList(traits), nil
}

func HasTrait(item *Instance, expected string) (bool, error) {
	return HasAllTraits(item, expected)
}

func HasAllTraits(item *Instance, expected ...string) (bool, error) {
	traits, err := ResolveTraits(item)
	if err != nil {
		return false, err
	}
	required := normalizeStringList(expected)
	if len(required) == 0 {
		return false, nil
	}
	for _, trait := range required {
		if !containsString(traits, trait) {
			return false, nil
		}
	}
	return true, nil
}

func ResolveCapabilities(item *Instance) ([]string, error) {
	traits, err := ResolveTraits(item)
	if err != nil {
		return nil, err
	}
	if len(traits) == 0 {
		return nil, nil
	}
	capabilities := []string{}
	if containsString(traits, "cache") && containsString(traits, "kv") {
		capabilities = append(capabilities, CapabilityCredentialProbeRedis)
	}
	return normalizeStringList(capabilities), nil
}

func HasCapability(item *Instance, expected string) (bool, error) {
	return HasAllCapabilities(item, expected)
}

func HasAllCapabilities(item *Instance, expected ...string) (bool, error) {
	capabilities, err := ResolveCapabilities(item)
	if err != nil {
		return false, err
	}
	required := normalizeStringList(expected)
	if len(required) == 0 {
		return false, nil
	}
	for _, capability := range required {
		if !containsString(capabilities, capability) {
			return false, nil
		}
	}
	return true, nil
}

func normalizeStringList(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		normalized := strings.TrimSpace(strings.ToLower(value))
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func cloneStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	result := make([]string, len(values))
	copy(result, values)
	return result
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}