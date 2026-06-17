package aiproviders

import (
	"fmt"
	"strings"

	"github.com/websoft9/appos/backend/domain/resource/connectors"
)

const (
	ProtocolOpenAI    = "openai"
	ProtocolAnthropic = "anthropic"
	ProtocolOllama    = "ollama"

	configDefaultProtocolKey   = "default_protocol"
	configProtocolEndpointsKey = "protocol_endpoints"
)

func NormalizeProtocol(raw string) string {
	trimmed := strings.TrimSpace(strings.ToLower(raw))
	switch trimmed {
	case ProtocolOpenAI, ProtocolAnthropic, ProtocolOllama:
		return trimmed
	default:
		return trimmed
	}
}

func TemplateProtocols(template Template) []TemplateProtocol {
	if len(template.Protocols) > 0 {
		result := make([]TemplateProtocol, len(template.Protocols))
		copy(result, template.Protocols)
		return result
	}

	defaultEndpoint := strings.TrimSpace(template.DefaultEndpoint)
	switch connectors.NormalizeTemplateID(template.ID) {
	case "anthropic":
		return []TemplateProtocol{{ID: ProtocolAnthropic, Label: "Anthropic", Default: true, DefaultEndpoint: defaultEndpoint}}
	case "ollama":
		return []TemplateProtocol{{ID: ProtocolOllama, Label: "Ollama", Default: true, DefaultEndpoint: "http://localhost:11434"}}
	default:
		return []TemplateProtocol{{ID: ProtocolOpenAI, Label: "OpenAI", Default: true, DefaultEndpoint: defaultEndpoint}}
	}
}

func TemplateDefaultProtocol(template Template) string {
	protocols := TemplateProtocols(template)
	for _, protocol := range protocols {
		if protocol.Default {
			return NormalizeProtocol(protocol.ID)
		}
	}
	for _, protocol := range protocols {
		if normalized := NormalizeProtocol(protocol.ID); normalized != "" {
			return normalized
		}
	}
	return ProtocolOpenAI
}

func ProviderDefaultProtocol(provider *AIProvider) string {
	if provider == nil {
		return ""
	}
	config := provider.Config()
	if normalized := NormalizeProtocol(firstConfigString(config, configDefaultProtocolKey)); normalized != "" {
		return normalized
	}
	template, _ := FindTemplate(provider.TemplateID())
	return TemplateDefaultProtocol(template)
}

func ProviderProtocolEndpoints(provider *AIProvider) map[string]string {
	result := map[string]string{}
	if provider == nil {
		return result
	}
	for key, value := range protocolEndpointsFromConfig(provider.Config()) {
		result[key] = value
	}
	defaultProtocol := ProviderDefaultProtocol(provider)
	if defaultProtocol == "" {
		template, _ := FindTemplate(provider.TemplateID())
		defaultProtocol = TemplateDefaultProtocol(template)
	}
	if endpoint := strings.TrimSpace(provider.Endpoint()); endpoint != "" && defaultProtocol != "" && result[defaultProtocol] == "" {
		result[defaultProtocol] = endpoint
	}
	return result
}

func EndpointForProtocol(provider *AIProvider, protocol string) string {
	protocol = NormalizeProtocol(protocol)
	if provider == nil {
		return ""
	}
	endpoints := ProviderProtocolEndpoints(provider)
	if endpoint := strings.TrimSpace(endpoints[protocol]); endpoint != "" {
		return endpoint
	}
	if protocol == ProviderDefaultProtocol(provider) {
		return strings.TrimSpace(provider.Endpoint())
	}
	return ""
}

func ActiveEndpoint(provider *AIProvider) string {
	if provider == nil {
		return ""
	}
	endpoint := EndpointForProtocol(provider, ProviderDefaultProtocol(provider))
	if endpoint != "" {
		return endpoint
	}
	return strings.TrimSpace(provider.Endpoint())
}

func NormalizeProtocolConfig(template Template, endpoint string, config map[string]any) (string, map[string]any) {
	cloned := cloneProtocolConfig(config)
	defaultProtocol := NormalizeProtocol(firstConfigString(cloned, configDefaultProtocolKey))
	if defaultProtocol == "" {
		defaultProtocol = TemplateDefaultProtocol(template)
	}

	endpoints := protocolEndpointsFromConfig(cloned)
	if trimmedEndpoint := strings.TrimSpace(endpoint); trimmedEndpoint != "" && defaultProtocol != "" && strings.TrimSpace(endpoints[defaultProtocol]) == "" {
		endpoints[defaultProtocol] = trimmedEndpoint
	}

	if strings.TrimSpace(endpoints[defaultProtocol]) == "" {
		for _, protocol := range TemplateProtocols(template) {
			normalizedID := NormalizeProtocol(protocol.ID)
			candidate := resolveProtocolDefaultEndpoint(protocol, cloned)
			if candidate != "" && endpoints[normalizedID] == "" {
				endpoints[normalizedID] = candidate
			}
		}
	}

	activeEndpoint := strings.TrimSpace(endpoints[defaultProtocol])
	if activeEndpoint == "" {
		for _, protocol := range TemplateProtocols(template) {
			if candidate := strings.TrimSpace(endpoints[NormalizeProtocol(protocol.ID)]); candidate != "" {
				defaultProtocol = NormalizeProtocol(protocol.ID)
				activeEndpoint = candidate
				break
			}
		}
	}
	if activeEndpoint == "" {
		activeEndpoint = strings.TrimSpace(endpoint)
	}
	if defaultProtocol == "" {
		defaultProtocol = ProtocolOpenAI
	}

	cloned[configDefaultProtocolKey] = defaultProtocol
	if len(endpoints) == 0 {
		delete(cloned, configProtocolEndpointsKey)
	} else {
		normalized := map[string]any{}
		for key, value := range endpoints {
			trimmed := strings.TrimSpace(value)
			if trimmed == "" {
				continue
			}
			normalized[key] = trimmed
		}
		if len(normalized) == 0 {
			delete(cloned, configProtocolEndpointsKey)
		} else {
			cloned[configProtocolEndpointsKey] = normalized
		}
	}
	return activeEndpoint, cloned
}

func firstConfigString(config map[string]any, key string) string {
	if config == nil {
		return ""
	}
	value, ok := config[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func protocolEndpointsFromConfig(config map[string]any) map[string]string {
	result := map[string]string{}
	if config == nil {
		return result
	}
	raw, ok := config[configProtocolEndpointsKey]
	if !ok || raw == nil {
		return result
	}
	switch typed := raw.(type) {
	case map[string]any:
		for key, value := range typed {
			normalizedKey := NormalizeProtocol(key)
			trimmedValue := strings.TrimSpace(fmt.Sprint(value))
			if normalizedKey != "" && trimmedValue != "" {
				result[normalizedKey] = trimmedValue
			}
		}
	case map[string]string:
		for key, value := range typed {
			normalizedKey := NormalizeProtocol(key)
			trimmedValue := strings.TrimSpace(value)
			if normalizedKey != "" && trimmedValue != "" {
				result[normalizedKey] = trimmedValue
			}
		}
	}
	return result
}

func cloneProtocolConfig(input map[string]any) map[string]any {
	if input == nil {
		return map[string]any{}
	}
	output := make(map[string]any, len(input))
	for key, value := range input {
		switch typed := value.(type) {
		case map[string]any:
			child := make(map[string]any, len(typed))
			for childKey, childValue := range typed {
				child[childKey] = childValue
			}
			output[key] = child
		default:
			output[key] = value
		}
	}
	return output
}

func resolveProtocolDefaultEndpoint(protocol TemplateProtocol, values map[string]any) string {
	endpointTemplate := strings.TrimSpace(protocol.DefaultEndpoint)
	if endpointTemplate == "" {
		return ""
	}
	return strings.TrimSpace(protocolValueTemplate(endpointTemplate, values))
}

func protocolValueTemplate(template string, values map[string]any) string {
	return placeholderPattern.ReplaceAllStringFunc(template, func(match string) string {
		key := strings.TrimSuffix(strings.TrimPrefix(match, "{"), "}")
		resolved := strings.TrimSpace(fmt.Sprint(values[key]))
		if resolved != "" {
			return resolved
		}
		if key == "region" {
			return "us-east-1"
		}
		return ""
	})
}