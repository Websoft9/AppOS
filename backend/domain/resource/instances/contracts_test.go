package instances

import "testing"

func TestAllowedKindsMatchDeclaredContracts(t *testing.T) {
	kinds := AllowedKinds()
	contracts := KindContracts()
	if len(kinds) != len(contracts) {
		t.Fatalf("expected %d allowed kinds, got %d", len(contracts), len(kinds))
	}
	for index, contract := range contracts {
		if kinds[index] != contract.Kind {
			t.Fatalf("expected allowed kind %q at index %d, got %q", contract.Kind, index, kinds[index])
		}
	}
}

func TestTemplateInheritsKindContractTraits(t *testing.T) {
	template, ok, err := FindTemplate("generic-rabbitmq")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected generic-rabbitmq template")
	}
	if template.Kind != KindAMQPCompatible {
		t.Fatalf("expected template kind %q, got %q", KindAMQPCompatible, template.Kind)
	}
	assertTraits(t, template.Traits, []string{"pubsub", "queue"})
}

func TestResolveTraitsUsesKindContract(t *testing.T) {
	item := RestoreInstance(Snapshot{
		Name:       "db-primary",
		Kind:       KindPostgresCompatible,
		TemplateID: "generic-postgres",
	})

	traits, err := ResolveTraits(item)
	if err != nil {
		t.Fatal(err)
	}
	assertTraits(t, traits, []string{"relational", "sql"})
}

func TestHasAllTraitsUsesResolvedTraits(t *testing.T) {
	item := RestoreInstance(Snapshot{
		Name:       "cache-primary",
		Kind:       KindRedisCompatible,
		TemplateID: "generic-redis",
	})

	ok, err := HasAllTraits(item, "cache", "kv")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected redis-compatible instance to satisfy cache+kv traits")
	}

	ok, err = HasAllTraits(item, "gateway")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected redis-compatible instance to miss gateway trait")
	}

	ok, err = HasTrait(item, "cache")
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected redis-compatible instance to satisfy cache trait")
	}
}

func TestResolveCapabilitiesUsesInstanceSemantics(t *testing.T) {
	redis := RestoreInstance(Snapshot{
		Name:       "cache-primary",
		Kind:       KindRedisCompatible,
		TemplateID: "generic-redis",
	})
	capabilities, err := ResolveCapabilities(redis)
	if err != nil {
		t.Fatal(err)
	}
	assertTraits(t, capabilities, []string{CapabilityCredentialProbeRedis})

	ok, err := HasCapability(redis, CapabilityCredentialProbeRedis)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected redis-compatible instance to expose redis credential probe capability")
	}

	gateway := RestoreInstance(Snapshot{
		Name:       "stream-primary",
		Kind:       KindKafkaCompatible,
		TemplateID: "generic-kafka",
	})
	ok, err = HasCapability(gateway, CapabilityCredentialProbeRedis)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected kafka-compatible instance to not expose redis credential probe capability")
	}
}

func TestGenericTemplatesResolveExpectedContractMetadata(t *testing.T) {
	tests := []struct {
		templateID string
		kind       string
		category   string
		traits     []string
	}{
		{templateID: "generic-mysql", kind: KindMySQLCompatible, category: "database", traits: []string{"relational", "sql"}},
		{templateID: "generic-postgres", kind: KindPostgresCompatible, category: "database", traits: []string{"relational", "sql"}},
		{templateID: "generic-mongodb", kind: KindMongoDBCompatible, category: "database", traits: []string{"document", "nosql"}},
		{templateID: "generic-clickhouse", kind: KindClickHouseCompatible, category: "database", traits: []string{"analytical", "sql", "columnar"}},
		{templateID: "generic-neo4j", kind: KindNeo4jCompatible, category: "database", traits: []string{"graph"}},
		{templateID: "generic-influxdb", kind: KindInfluxDBCompatible, category: "database", traits: []string{"timeseries"}},
		{templateID: "generic-redis", kind: KindRedisCompatible, category: "cache", traits: []string{"cache", "kv"}},
		{templateID: "generic-elasticsearch", kind: KindElasticsearchCompatible, category: "search", traits: []string{"search", "index"}},
		{templateID: "generic-kafka", kind: KindKafkaCompatible, category: "message-queue", traits: []string{"pubsub", "streaming"}},
		{templateID: "generic-rabbitmq", kind: KindAMQPCompatible, category: "message-queue", traits: []string{"pubsub", "queue"}},
		{templateID: "generic-nats", kind: KindNATSCompatible, category: "message-queue", traits: []string{"pubsub", "lightweight"}},
		{templateID: "generic-mqtt", kind: KindMQTTCompatible, category: "message-queue", traits: []string{"pubsub", "iot"}},
		{templateID: "generic-s3", kind: KindS3Compatible, category: "storage", traits: []string{"object-storage"}},
		{templateID: "generic-onlyoffice", kind: KindOnlyOfficeCompatible, category: "application-service", traits: []string{"document", "editor", "collaboration"}},
	}

	for _, tt := range tests {
		t.Run(tt.templateID, func(t *testing.T) {
			template, ok, err := FindTemplate(tt.templateID)
			if err != nil {
				t.Fatal(err)
			}
			if !ok {
				t.Fatalf("expected template %q", tt.templateID)
			}
			if template.Kind != tt.kind {
				t.Fatalf("expected kind %q, got %q", tt.kind, template.Kind)
			}
			if template.Category != tt.category {
				t.Fatalf("expected category %q, got %q", tt.category, template.Category)
			}
			assertTraits(t, template.Traits, tt.traits)
		})
	}
}

func assertTraits(t *testing.T, actual []string, expected []string) {
	t.Helper()
	if len(actual) != len(expected) {
		t.Fatalf("expected %d traits, got %d: %+v", len(expected), len(actual), actual)
	}
	for _, want := range expected {
		found := false
		for _, got := range actual {
			if got == want {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("expected trait %q in %+v", want, actual)
		}
	}
}