package copilot

import (
	"context"
	"fmt"
	"strconv"
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
			if !item.IsEnabled() {
				return nil, coded(CodeProviderSetupRequired, "selected LLM provider is disabled", nil)
			}
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
		if !item.IsEnabled() {
			continue
		}
		if item.IsDefault() {
			selected = item
			break
		}
	}
	if selected == nil {
		enabled := make([]*aiproviders.AIProvider, 0, len(items))
		for _, item := range items {
			if item.IsEnabled() {
				enabled = append(enabled, item)
			}
		}
		if len(enabled) == 1 {
			selected = enabled[0]
		}
	}
	if selected == nil {
		return nil, coded(CodeProviderSetupRequired, "default LLM provider is not configured", nil)
	}
	return selected, nil
}

func (r *DefaultProviderResolver) providerConfig(ctx context.Context, actorID string, selected *aiproviders.AIProvider) (*ProviderConfig, error) {
	protocol := aiproviders.ProviderDefaultProtocol(selected)
	endpoint := strings.TrimSpace(aiproviders.ActiveEndpoint(selected))
	credentialID := strings.TrimSpace(selected.CredentialID())
	model := firstConfigString(selected.Config(), "defaultModel", "model")
	apiVersion := firstConfigString(selected.Config(), "version", "apiVersion")
	httpReferer := firstConfigString(selected.Config(), "httpReferer", "http_referer", "referer")
	maxCompletionTokens := firstConfigInt(selected.Config(), "max_completion_tokens", "maxCompletionTokens")
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
	tpl, _ := aiproviders.FindTemplate(selected.TemplateID())
	if maxCompletionTokens == nil {
		maxCompletionTokens = templateFieldDefaultInt(tpl, "max_completion_tokens")
	}

	return &ProviderConfig{
		Name:                selected.Name(),
		Protocol:            protocol,
		Endpoint:            strings.TrimRight(endpoint, "/"),
		Model:               model,
		APIKey:              apiKey,
		AuthScheme:          strings.TrimSpace(selected.AuthScheme()),
		APIVersion:          apiVersion,
		HTTPReferer:         httpReferer,
		MaxCompletionTokens: maxCompletionTokens,
		ContextSize:         tpl.ContextSize,
	}, nil
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

func firstConfigInt(config map[string]any, keys ...string) *int {
	for _, key := range keys {
		value, ok := config[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case int:
			if typed > 0 {
				result := typed
				return &result
			}
		case int32:
			if typed > 0 {
				result := int(typed)
				return &result
			}
		case int64:
			if typed > 0 {
				result := int(typed)
				return &result
			}
		case float64:
			if typed > 0 {
				result := int(typed)
				return &result
			}
		case string:
			text := strings.TrimSpace(typed)
			if text == "" {
				continue
			}
			parsed, err := strconv.Atoi(text)
			if err == nil && parsed > 0 {
				return &parsed
			}
		}
	}
	return nil
}

func templateFieldDefaultInt(template aiproviders.Template, fieldID string) *int {
	fieldID = strings.TrimSpace(fieldID)
	if fieldID == "" {
		return nil
	}
	for _, field := range template.Fields {
		if strings.TrimSpace(field.ID) != fieldID || field.Default == nil {
			continue
		}
		switch typed := field.Default.(type) {
		case int:
			if typed > 0 {
				result := typed
				return &result
			}
		case int32:
			if typed > 0 {
				result := int(typed)
				return &result
			}
		case int64:
			if typed > 0 {
				result := int(typed)
				return &result
			}
		case float64:
			if typed > 0 {
				result := int(typed)
				return &result
			}
		case string:
			text := strings.TrimSpace(typed)
			if text == "" {
				return nil
			}
			parsed, err := strconv.Atoi(text)
			if err == nil && parsed > 0 {
				return &parsed
			}
		}
	}
	return nil
}
