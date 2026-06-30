package aiproviders

import (
	"context"
	"errors"
	"fmt"
	"strings"

	resourceshared "github.com/websoft9/appos/backend/domain/resource/shared"
)

type SaveInput struct {
	Name              string
	Kind              string
	IsEnabled         bool
	IsDefault         bool
	TemplateID        string
	Endpoint          string
	AuthScheme        string
	ProviderAccountID string
	CredentialID      string
	Config            map[string]any
	Description       string
}

type CredentialRefValidator = resourceshared.CredentialRefValidator

type ProviderAccountRefValidator = resourceshared.ProviderAccountRefValidator

type SaveDeps struct {
	ActorID                     string
	CredentialRefValidator      CredentialRefValidator
	ProviderAccountRefValidator ProviderAccountRefValidator
	TemplateResolver            func(templateID string) (Template, bool, error)
}

func List(repo Repository) ([]*AIProvider, error) {
	items, err := repo.List()
	if err != nil {
		return nil, err
	}
	result := make([]*AIProvider, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item.Kind()) == KindLLM {
			result = append(result, item)
		}
	}
	return result, nil
}

func Get(repo Repository, id string) (*AIProvider, error) {
	item, err := repo.Get(id)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(item.Kind()) != KindLLM {
		return nil, &NotFoundError{ID: id}
	}
	return item, nil
}

func Create(repo Repository, input SaveInput) (*AIProvider, error) {
	return CreateWithDeps(repo, input, SaveDeps{})
}

func CreateWithDeps(repo Repository, input SaveInput, deps SaveDeps) (*AIProvider, error) {
	item, err := repo.New()
	if err != nil {
		return nil, err
	}
	if err := saveRecord(repo, item, input, deps); err != nil {
		return nil, err
	}
	return item, nil
}

func Update(repo Repository, id string, input SaveInput) (*AIProvider, error) {
	item, err := Get(repo, id)
	if err != nil {
		return nil, err
	}
	return UpdateExistingWithDeps(repo, item, input, SaveDeps{})
}

func UpdateExisting(repo Repository, existing *AIProvider, input SaveInput) (*AIProvider, error) {
	return UpdateExistingWithDeps(repo, existing, input, SaveDeps{})
}

func UpdateExistingWithDeps(repo Repository, existing *AIProvider, input SaveInput, deps SaveDeps) (*AIProvider, error) {
	if err := saveRecord(repo, existing, input, deps); err != nil {
		return nil, err
	}
	return existing, nil
}

func Delete(repo Repository, id string) error {
	item, err := Get(repo, id)
	if err != nil {
		return err
	}
	return DeleteExisting(repo, item)
}

func DeleteExisting(repo Repository, existing *AIProvider) error {
	return repo.Delete(existing)
}

func saveRecord(repo Repository, provider *AIProvider, input SaveInput, deps SaveDeps) error {
	normalized, err := normalizeSaveInput(input)
	if err != nil {
		return err
	}
	provider.ApplySaveInput(normalized)

	if err := applyTemplateConstraints(provider, deps.TemplateResolver); err != nil {
		return err
	}

	return repo.RunInTransaction(func(txRepo Repository) error {
		if err := resourceshared.ValidateProviderAccountRef(provider.ProviderAccountID(), deps.ActorID, deps.ProviderAccountRefValidator); err != nil {
			return err
		}
		if err := resourceshared.ValidateCredentialRef(provider.CredentialID(), deps.ActorID, deps.CredentialRefValidator); err != nil {
			return err
		}
		exists, err := txRepo.ExistsByName(provider.Name(), provider.ID())
		if err != nil {
			return err
		}
		if exists {
			return &ConflictError{Message: "AI provider name already exists"}
		}
		if provider.IsDefault() {
			if err := txRepo.ClearDefaultsByTemplate(provider.TemplateID(), provider.ID()); err != nil {
				return err
			}
		}
		return txRepo.Save(provider)
	})
}

func applyTemplateConstraints(provider *AIProvider, templateResolver func(templateID string) (Template, bool, error)) error {
	kind := strings.TrimSpace(provider.Kind())
	name := strings.TrimSpace(provider.Name())
	templateID := resourceshared.NormalizeTemplateID(provider.TemplateID())
	authScheme := strings.TrimSpace(provider.AuthScheme())
	resolveTemplate := templateResolver
	if resolveTemplate == nil {
		resolveTemplate = FindTemplate
	}

	if name == "" {
		return &ValidationError{Message: "name is required"}
	}
	if kind == "" {
		return &ValidationError{Message: "kind is required"}
	}
	if !IsAllowedKind(kind) {
		return &ValidationError{Message: fmt.Sprintf("unsupported kind %q", kind)}
	}

	if templateID != "" {
		template, ok, err := resolveTemplate(templateID)
		if err != nil {
			return err
		}
		if !ok {
			return &ValidationError{Message: fmt.Sprintf("unknown template_id %q", templateID)}
		}
		if template.Kind != kind {
			return &ValidationError{Message: fmt.Sprintf("template %q has kind %q, not %q", templateID, template.Kind, kind)}
		}
		provider.SetTemplateID(template.ID)
		if authScheme == "" {
			provider.SetAuthScheme(template.DefaultAuth)
		}
		if strings.TrimSpace(provider.Endpoint()) == "" && strings.TrimSpace(template.DefaultEndpoint) != "" {
			provider.SetEndpoint(template.DefaultEndpoint)
		}
	}

	if strings.TrimSpace(provider.AuthScheme()) == "" {
		provider.SetAuthScheme(AuthSchemeNone)
	}
	provider.EnsureConfig()
	return nil
}

func normalizeSaveInput(input SaveInput) (SaveInput, error) {
	input.Kind = strings.TrimSpace(input.Kind)
	if input.Kind == "" {
		input.Kind = KindLLM
	}
	if input.Kind != KindLLM {
		return SaveInput{}, &ValidationError{Message: fmt.Sprintf("unsupported kind %q", input.Kind)}
	}
	if templateID := resourceshared.NormalizeTemplateID(input.TemplateID); templateID != "" {
		template, ok, err := FindTemplate(templateID)
		if err != nil {
			return SaveInput{}, err
		}
		if !ok {
			return SaveInput{}, &ValidationError{Message: fmt.Sprintf("unknown template_id %q", templateID)}
		}
		if template.Kind != KindLLM {
			return SaveInput{}, &ValidationError{Message: fmt.Sprintf("template %q has kind %q, not %q", templateID, template.Kind, KindLLM)}
		}
		input.TemplateID = template.ID
		input.Endpoint, input.Config = NormalizeProtocolConfig(template, input.Endpoint, input.Config)
		return input, nil
	}
	input.Endpoint, input.Config = NormalizeProtocolConfig(Template{}, input.Endpoint, input.Config)
	return input, nil
}

type APIKeyResolver func(context.Context, *AIProvider) (string, error)
type ModelsFetcher func(context.Context, *AIProvider, string) (FetchModelsResponse, error)

type PruneUnavailableEnabledModelsResult struct {
	ProvidersScanned int
	ProvidersUpdated int
	ModelsRemoved    int
}

func PruneUnavailableEnabledModels(
	ctx context.Context,
	repo Repository,
	resolveAPIKey APIKeyResolver,
	fetchModels ModelsFetcher,
) (PruneUnavailableEnabledModelsResult, error) {
	var result PruneUnavailableEnabledModelsResult
	items, err := List(repo)
	if err != nil {
		return result, err
	}

	var pruneErrors []error
	for _, item := range items {
		current := enabledModelsFromConfig(item.Config())
		if len(current) == 0 {
			continue
		}
		result.ProvidersScanned++

		apiKey, resolveErr := resolveAPIKey(ctx, item)
		if resolveErr != nil {
			pruneErrors = append(pruneErrors, fmt.Errorf("provider %s resolve api key: %w", item.ID(), resolveErr))
			continue
		}
		activeEndpoint, protocol, protocolErr := ResolveActiveEndpointAndProtocol(item)
		if protocolErr != nil {
			pruneErrors = append(pruneErrors, fmt.Errorf("provider %s resolve protocol: %w", item.ID(), protocolErr))
			continue
		}
		fetch := fetchModels
		if fetch == nil {
			fetch = func(ctx context.Context, item *AIProvider, apiKey string) (FetchModelsResponse, error) {
				return FetchModels(ctx, activeEndpoint, apiKey, strings.TrimSpace(item.TemplateID()), protocol, nil)
			}
		}

		fetched, fetchErr := fetch(ctx, item, apiKey)
		if fetchErr != nil {
			pruneErrors = append(pruneErrors, fmt.Errorf("provider %s fetch models: %w", item.ID(), fetchErr))
			continue
		}

		available := make(map[string]struct{}, len(fetched.Models))
		for _, model := range fetched.Models {
			available[strings.TrimSpace(model.ID)] = struct{}{}
		}
		next := make([]string, 0, len(current))
		for _, modelID := range current {
			if _, ok := available[modelID]; ok {
				next = append(next, modelID)
			}
		}
		removed := len(current) - len(next)
		if removed <= 0 {
			continue
		}

		snapshot := item.Snapshot()
		config := cloneStringAnyMap(snapshot.Config)
		if len(next) > 0 {
			config["enabled_models"] = next
		} else {
			delete(config, "enabled_models")
		}
		item.ApplySaveInput(SaveInput{
			Name:              snapshot.Name,
			Kind:              snapshot.Kind,
			IsEnabled:         snapshot.IsEnabled,
			IsDefault:         snapshot.IsDefault,
			TemplateID:        snapshot.TemplateID,
			Endpoint:          snapshot.Endpoint,
			AuthScheme:        snapshot.AuthScheme,
			ProviderAccountID: snapshot.ProviderAccountID,
			CredentialID:      snapshot.CredentialID,
			Config:            config,
			Description:       snapshot.Description,
		})
		if saveErr := repo.Save(item); saveErr != nil {
			pruneErrors = append(pruneErrors, fmt.Errorf("provider %s save pruned models: %w", item.ID(), saveErr))
			continue
		}

		result.ProvidersUpdated++
		result.ModelsRemoved += removed
	}

	return result, errors.Join(pruneErrors...)
}

func enabledModelsFromConfig(config map[string]any) []string {
	if config == nil {
		return nil
	}
	raw, ok := config["enabled_models"]
	if !ok || raw == nil {
		return nil
	}
	switch typed := raw.(type) {
	case []string:
		return normalizeStringSlice(typed)
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			result = append(result, fmt.Sprint(item))
		}
		return normalizeStringSlice(result)
	default:
		return nil
	}
}

func normalizeStringSlice(values []string) []string {
	result := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func cloneStringAnyMap(input map[string]any) map[string]any {
	if input == nil {
		return map[string]any{}
	}
	result := make(map[string]any, len(input))
	for key, value := range input {
		result[key] = value
	}
	return result
}
