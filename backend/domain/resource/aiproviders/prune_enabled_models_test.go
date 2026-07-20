package aiproviders

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

type stubRepository struct {
	items []*AIProvider
	name  map[string]*AIProvider
}

func newStubRepository(items ...*AIProvider) *stubRepository {
	byID := make(map[string]*AIProvider, len(items))
	for _, item := range items {
		byID[item.ID()] = item
	}
	return &stubRepository{items: items, name: byID}
}

func (r *stubRepository) List() ([]*AIProvider, error)                             { return r.items, nil }
func (r *stubRepository) Get(id string) (*AIProvider, error)                       { return r.name[id], nil }
func (r *stubRepository) New() (*AIProvider, error)                                { return NewAIProvider(), nil }
func (r *stubRepository) ExistsByName(name string, excludeID string) (bool, error) { return false, nil }
func (r *stubRepository) Save(connector *AIProvider) error {
	r.name[connector.ID()] = connector
	return nil
}
func (r *stubRepository) Delete(connector *AIProvider) error            { return nil }
func (r *stubRepository) ListByKind(kind string) ([]*AIProvider, error) { return r.items, nil }
func (r *stubRepository) ClearDefaultsByTemplate(templateID string, excludeID string) error {
	return nil
}
func (r *stubRepository) RunInTransaction(run func(Repository) error) error { return run(r) }

func TestPruneUnavailableEnabledModelsRemovesInvalidSelections(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1beta/openai/models" {
			t.Fatalf("expected /v1beta/openai/models, got %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"gemini-3.5-flash"}]}`))
	}))
	defer server.Close()

	provider := RestoreAIProvider(Snapshot{
		ID:           "provider-1",
		Name:         "gemini-main",
		Kind:         KindLLM,
		TemplateID:   "google-gemini",
		Endpoint:     server.URL + "/v1beta/openai",
		CredentialID: "secret-1",
		Config: map[string]any{
			"enabled_models": []any{"gemini-3.5-flash", "stale-model-id"},
		},
	})
	repo := newStubRepository(provider)

	result, err := PruneUnavailableEnabledModels(
		context.Background(),
		repo,
		func(context.Context, *AIProvider) (string, error) { return "test-key", nil },
		nil,
	)
	if err != nil {
		t.Fatalf("prune unavailable enabled models: %v", err)
	}
	if result.ProvidersScanned != 1 {
		t.Fatalf("expected 1 provider scanned, got %d", result.ProvidersScanned)
	}
	if result.ProvidersUpdated != 1 {
		t.Fatalf("expected 1 provider updated, got %d", result.ProvidersUpdated)
	}
	if result.ModelsRemoved != 1 {
		t.Fatalf("expected 1 model removed, got %d", result.ModelsRemoved)
	}

	updated := enabledModelsFromConfig(provider.Config())
	if len(updated) != 1 || updated[0] != "gemini-3.5-flash" {
		t.Fatalf("expected only valid model to remain, got %#v", updated)
	}
	if _, ok := provider.Config()["enabled_models"]; !ok {
		t.Fatalf("expected enabled_models to remain in config")
	}
}

func TestPruneUnavailableEnabledModelsClearsConfigWhenInventoryIsEmpty(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer server.Close()

	provider := RestoreAIProvider(Snapshot{
		ID:           "provider-2",
		Name:         "gemini-empty",
		Kind:         KindLLM,
		TemplateID:   "google-gemini",
		Endpoint:     server.URL + "/v1beta/openai",
		CredentialID: "secret-2",
		Config: map[string]any{
			"enabled_models": []string{"stale-model-id"},
		},
	})
	repo := newStubRepository(provider)

	result, err := PruneUnavailableEnabledModels(
		context.Background(),
		repo,
		func(context.Context, *AIProvider) (string, error) { return "test-key", nil },
		nil,
	)
	if err != nil {
		t.Fatalf("prune unavailable enabled models: %v", err)
	}
	if result.ProvidersUpdated != 1 || result.ModelsRemoved != 1 {
		t.Fatalf("unexpected prune result: %+v", result)
	}
	if got := enabledModelsFromConfig(provider.Config()); len(got) != 0 {
		t.Fatalf("expected no enabled models after prune, got %#v", got)
	}
	if _, ok := provider.Config()["enabled_models"]; ok {
		t.Fatalf("expected enabled_models key to be removed when inventory is empty")
	}
}
