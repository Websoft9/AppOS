package shared

import (
	"encoding/json"
	"strings"
)

func NormalizeTemplateID(raw string) string {
	trimmed := strings.TrimSpace(strings.ToLower(raw))
	trimmed = strings.ReplaceAll(trimmed, "_", "-")
	trimmed = strings.ReplaceAll(trimmed, " ", "-")
	return trimmed
}

func CloneMap(input map[string]any) map[string]any {
	if input == nil {
		return map[string]any{}
	}
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = CloneValue(value)
	}
	return output
}

func CloneValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return CloneMap(typed)
	case []any:
		clone := make([]any, len(typed))
		for index, item := range typed {
			clone[index] = CloneValue(item)
		}
		return clone
	default:
		return value
	}
}

func DecodeConfig(raw any) map[string]any {
	if config, ok := raw.(map[string]any); ok {
		return CloneMap(config)
	}
	if raw == nil {
		return map[string]any{}
	}

	var bytes []byte
	switch typed := raw.(type) {
	case []byte:
		bytes = typed
	case string:
		bytes = []byte(typed)
	default:
		marshaled, err := json.Marshal(typed)
		if err != nil {
			return map[string]any{}
		}
		bytes = marshaled
	}

	var decoded map[string]any
	if err := json.Unmarshal(bytes, &decoded); err != nil || decoded == nil {
		return map[string]any{}
	}
	return CloneMap(decoded)
}

func CloneStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	result := make([]string, len(values))
	copy(result, values)
	return result
}

func NormalizeStringList(values []string) []string {
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

func ContainsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
