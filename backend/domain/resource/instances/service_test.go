package instances

import "testing"

type stubRepository struct {
	items map[string]*Instance
	next  int
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

func TestCreateAppliesTemplateDefaultEndpoint(t *testing.T) {
	repo := newStubRepository()
	item, err := Create(repo, SaveInput{
		Name:       "Local Ollama",
		Kind:       KindOllama,
		TemplateID: "generic-ollama",
	})
	if err != nil {
		t.Fatal(err)
	}
	if item.Endpoint() != "http://localhost:11434" {
		t.Fatalf("expected template default endpoint, got %q", item.Endpoint())
	}
}

func TestCreateRejectsTemplateKindMismatch(t *testing.T) {
	repo := newStubRepository()
	_, err := Create(repo, SaveInput{
		Name:       "Bad Redis",
		Kind:       KindRedis,
		TemplateID: "generic-postgres",
	})
	if err == nil {
		t.Fatal("expected mismatched template kind to fail")
	}
}

func TestTemplatesCoverAllInstanceKinds(t *testing.T) {
	counts := map[string]int{}
	for _, template := range Templates() {
		counts[template.Kind]++
	}

	for _, kind := range []string{
		KindMySQL,
		KindPostgres,
		KindRedis,
		KindKafka,
		KindS3,
		KindRegistry,
		KindOllama,
	} {
		if counts[kind] == 0 {
			t.Fatalf("expected at least one template for kind %q", kind)
		}
	}
}
