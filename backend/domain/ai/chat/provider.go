package chat

import (
	"context"
	"fmt"
	"strings"

	"github.com/websoft9/appos/backend/domain/resource/aiproviders"
	"github.com/websoft9/appos/backend/domain/secrets"
)

type SecretResolver interface {
	Resolve(ctx context.Context, secretID, actorID string) (*secrets.ResolveResult, error)
}

type DefaultProviderResolver struct {
	providers aiproviders.Repository
	secrets   SecretResolver
}

func NewDefaultProviderResolver(providers aiproviders.Repository, secrets SecretResolver) *DefaultProviderResolver {
	return &DefaultProviderResolver{providers: providers, secrets: secrets}
}

func (r *DefaultProviderResolver) ResolveDefault(ctx context.Context, actorID string) (*ProviderConfig, error) {
	selected, err := r.defaultProvider()
	if err != nil {
		return nil, err
	}
	return r.providerConfig(ctx, actorID, selected)
}

func (r *DefaultProviderResolver) ResolveSelection(ctx context.Context, actorID, providerID string) (*ProviderConfig, error) {
	items, err := r.providers.ListByKind(aiproviders.KindLLM)
	if err != nil {
		return nil, err
	}
	providerID = strings.TrimSpace(providerID)
	for _, item := range items {
		if item.ID() == providerID {
			return r.providerConfig(ctx, actorID, item)
		}
	}
	return nil, coded(CodeProviderSetupRequired, "selected LLM provider is not available", nil)
}

func (r *DefaultProviderResolver) defaultProvider() (*aiproviders.AIProvider, error) {
	items, err := r.providers.ListByKind(aiproviders.KindLLM)
	if err != nil {
		return nil, err
	}
	var selected *aiproviders.AIProvider
	for _, item := range items {
		if item.IsDefault() {
			selected = item
			break
		}
	}
	if selected == nil && len(items) == 1 {
		selected = items[0]
	}
	if selected == nil {
		return nil, coded(CodeProviderSetupRequired, "default LLM provider is not configured", nil)
	}
	return selected, nil
}

func (r *DefaultProviderResolver) providerConfig(ctx context.Context, actorID string, selected *aiproviders.AIProvider) (*ProviderConfig, error) {
	endpoint := strings.TrimSpace(selected.Endpoint())
	credentialID := strings.TrimSpace(selected.CredentialID())
	model := firstConfigString(selected.Config(), "defaultModel", "model")
	if endpoint == "" || credentialID == "" {
		return nil, coded(CodeProviderInvalid, "default LLM provider requires endpoint and credential", nil)
	}

	resolved, err := r.secrets.Resolve(ctx, credentialID, actorID)
	if err != nil {
		return nil, coded(CodeProviderInvalid, "failed to resolve LLM provider credential", err)
	}
	apiKey := secrets.FirstStringFromPayload(resolved.Payload, "apiKey", "api_key", "token", "value")
	if strings.TrimSpace(apiKey) == "" {
		return nil, coded(CodeProviderInvalid, "LLM provider credential does not contain an API key", nil)
	}

	return &ProviderConfig{Name: selected.Name(), Endpoint: strings.TrimRight(endpoint, "/"), Model: model, APIKey: apiKey}, nil
}

func firstConfigString(config map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := config[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				return strings.TrimSpace(typed)
			}
		default:
			text := strings.TrimSpace(fmt.Sprint(typed))
			if text != "" {
				return text
			}
		}
	}
	return ""
}
