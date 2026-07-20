package instances

import (
	"errors"
	"testing"
)

type stubRepository struct {
	items map[string]*Instance
	next  int
}

type stubCredentialValidator struct {
	err           error
	lastID        string
	lastActorID   string
	validateCalls int
}

type stubAccountValidator struct {
	err           error
	lastID        string
	lastActorID   string
	validateCalls int
}

func newStubRepository() *stubRepository {
	return &stubRepository{items: map[string]*Instance{}}
}

func (r *stubRepository) List() ([]*Instance, error) {
	result := make([]*Instance, 0, len(r.items))
	for _, item := range r.items {
		result = append(result, RestoreInstance(item.Snapshot()))
	}
	return result, nil
}

func (r *stubRepository) Get(id string) (*Instance, error) {
	item, ok := r.items[id]
	if !ok {
		return nil, &NotFoundError{ID: id}
	}
	return RestoreInstance(item.Snapshot()), nil
}

func (r *stubRepository) New() (*Instance, error) {
	return NewInstance(), nil
}

func (r *stubRepository) ExistsByName(name string, excludeID string) (bool, error) {
	for _, item := range r.items {
		if item.Name() != name {
			continue
		}
		if excludeID != "" && item.ID() == excludeID {
			continue
		}
		return true, nil
	}
	return false, nil
}

func (r *stubRepository) Save(instance *Instance) error {
	if instance.id == "" {
		r.next++
		instance.id = "instance-" + string(rune('0'+r.next))
	}
	r.items[instance.id] = RestoreInstance(instance.Snapshot())
	return nil
}

func (r *stubRepository) Delete(instance *Instance) error {
	delete(r.items, instance.ID())
	return nil
}

func (r *stubRepository) RunInTransaction(run func(Repository) error) error {
	return run(r)
}

func (v *stubCredentialValidator) ValidateCredentialRef(credentialID string, actorID string) error {
	v.validateCalls++
	v.lastID = credentialID
	v.lastActorID = actorID
	return v.err
}

func (v *stubAccountValidator) ValidateProviderAccountRef(providerAccountID string, actorID string) error {
	v.validateCalls++
	v.lastID = providerAccountID
	v.lastActorID = actorID
	return v.err
}

func TestCreateRejectsTemplateKindMismatch(t *testing.T) {
	repo := newStubRepository()
	_, err := Create(repo, SaveInput{
		Name:       "Bad Redis",
		Kind:       KindRedisCompatible,
		TemplateID: "generic-postgres",
	})
	if err == nil {
		t.Fatal("expected mismatched template kind to fail")
	}
}

func TestCreateRejectsUnsupportedKind(t *testing.T) {
	repo := newStubRepository()
	_, err := Create(repo, SaveInput{
		Name: "Bad Kind",
		Kind: "object_storage",
	})
	if err == nil {
		t.Fatal("expected unsupported kind to fail")
	}
}

func TestCreateRejectsDuplicateName(t *testing.T) {
	repo := newStubRepository()
	_, err := Create(repo, SaveInput{Name: "Primary Redis", Kind: KindRedisCompatible, TemplateID: "generic-redis"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = Create(repo, SaveInput{Name: "Primary Redis", Kind: KindKafkaCompatible, TemplateID: "generic-kafka"})
	if err == nil {
		t.Fatal("expected duplicate name to fail")
	}
	var conflictErr *ConflictError
	if !errors.As(err, &conflictErr) {
		t.Fatalf("expected duplicate-name error, got %v", err)
	}
}

func TestCreateValidatesCredentialReference(t *testing.T) {
	repo := newStubRepository()
	validator := &stubCredentialValidator{}
	_, err := CreateWithDeps(repo, SaveInput{
		Name:         "Primary Redis",
		Kind:         KindRedisCompatible,
		TemplateID:   "generic-redis",
		CredentialID: "secret-1",
	}, SaveDeps{
		ActorID:                "user-1",
		CredentialRefValidator: validator,
	})
	if err != nil {
		t.Fatal(err)
	}
	if validator.validateCalls != 1 {
		t.Fatalf("expected one credential validation call, got %d", validator.validateCalls)
	}
	if validator.lastID != "secret-1" || validator.lastActorID != "user-1" {
		t.Fatalf("unexpected validator input: id=%q actor=%q", validator.lastID, validator.lastActorID)
	}
}

func TestCreateRejectsCredentialWithoutValidator(t *testing.T) {
	repo := newStubRepository()
	_, err := Create(repo, SaveInput{
		Name:         "Primary Redis",
		Kind:         KindRedisCompatible,
		TemplateID:   "generic-redis",
		CredentialID: "secret-1",
	})
	if err == nil {
		t.Fatal("expected missing credential validator to fail")
	}
	var validationErr *ValidationError
	if !errors.As(err, &validationErr) {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func TestCreateValidatesProviderAccountReference(t *testing.T) {
	repo := newStubRepository()
	validator := &stubAccountValidator{}
	_, err := CreateWithDeps(repo, SaveInput{
		Name:              "Primary Redis",
		Kind:              KindRedisCompatible,
		TemplateID:        "generic-redis",
		ProviderAccountID: "acc-1",
	}, SaveDeps{
		ActorID:                     "user-1",
		ProviderAccountRefValidator: validator,
	})
	if err != nil {
		t.Fatal(err)
	}
	if validator.validateCalls != 1 {
		t.Fatalf("expected one provider account validation call, got %d", validator.validateCalls)
	}
	if validator.lastID != "acc-1" || validator.lastActorID != "user-1" {
		t.Fatalf("unexpected validator input: id=%q actor=%q", validator.lastID, validator.lastActorID)
	}
}

func TestCreateRejectsProviderAccountWithoutValidator(t *testing.T) {
	repo := newStubRepository()
	_, err := Create(repo, SaveInput{
		Name:              "Primary Redis",
		Kind:              KindRedisCompatible,
		TemplateID:        "generic-redis",
		ProviderAccountID: "acc-1",
	})
	if err == nil {
		t.Fatal("expected missing provider account validator to fail")
	}
	var validationErr *ValidationError
	if !errors.As(err, &validationErr) {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func TestTemplatesCoverAllInstanceKinds(t *testing.T) {
	counts := map[string]int{}
	templates, err := Templates()
	if err != nil {
		t.Fatal(err)
	}
	for _, template := range templates {
		counts[template.Kind]++
	}

	for _, kind := range []string{
		KindMySQLCompatible,
		KindPostgresCompatible,
		KindMongoDBCompatible,
		KindClickHouseCompatible,
		KindNeo4jCompatible,
		KindInfluxDBCompatible,
		KindRedisCompatible,
		KindElasticsearchCompatible,
		KindKafkaCompatible,
		KindAMQPCompatible,
		KindNATSCompatible,
		KindMQTTCompatible,
		KindS3Compatible,
		KindOnlyOfficeCompatible,
	} {
		if counts[kind] == 0 {
			t.Fatalf("expected at least one template for kind %q", kind)
		}
	}
}

func TestCreateAcceptsAllGenericContractKinds(t *testing.T) {
	repo := newStubRepository()
	tests := []struct {
		name       string
		kind       string
		templateID string
	}{
		{name: "mysql-primary", kind: KindMySQLCompatible, templateID: "generic-mysql"},
		{name: "postgres-primary", kind: KindPostgresCompatible, templateID: "generic-postgres"},
		{name: "mongodb-primary", kind: KindMongoDBCompatible, templateID: "generic-mongodb"},
		{name: "clickhouse-primary", kind: KindClickHouseCompatible, templateID: "generic-clickhouse"},
		{name: "neo4j-primary", kind: KindNeo4jCompatible, templateID: "generic-neo4j"},
		{name: "influxdb-primary", kind: KindInfluxDBCompatible, templateID: "generic-influxdb"},
		{name: "redis-primary", kind: KindRedisCompatible, templateID: "generic-redis"},
		{name: "elastic-primary", kind: KindElasticsearchCompatible, templateID: "generic-elasticsearch"},
		{name: "kafka-primary", kind: KindKafkaCompatible, templateID: "generic-kafka"},
		{name: "amqp-primary", kind: KindAMQPCompatible, templateID: "generic-rabbitmq"},
		{name: "nats-primary", kind: KindNATSCompatible, templateID: "generic-nats"},
		{name: "mqtt-primary", kind: KindMQTTCompatible, templateID: "generic-mqtt"},
		{name: "s3-primary", kind: KindS3Compatible, templateID: "generic-s3"},
		{name: "onlyoffice-primary", kind: KindOnlyOfficeCompatible, templateID: "generic-onlyoffice"},
	}

	for _, tt := range tests {
		t.Run(tt.kind, func(t *testing.T) {
			item, err := Create(repo, SaveInput{Name: tt.name, Kind: tt.kind, TemplateID: tt.templateID})
			if err != nil {
				t.Fatal(err)
			}
			if item.Kind() != tt.kind {
				t.Fatalf("expected kind %q, got %q", tt.kind, item.Kind())
			}
			if item.TemplateID() != tt.templateID {
				t.Fatalf("expected template %q, got %q", tt.templateID, item.TemplateID())
			}
		})
	}
}
