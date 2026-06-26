package aiproviders

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

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
		if fetchModels == nil {
			fetchModels = func(ctx context.Context, item *AIProvider, apiKey string) (FetchModelsResponse, error) {
				return FetchModels(ctx, ActiveEndpoint(item), apiKey, strings.TrimSpace(item.TemplateID()), ProviderDefaultProtocol(item), nil)
			}
		}

		fetched, fetchErr := fetchModels(ctx, item, apiKey)
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
