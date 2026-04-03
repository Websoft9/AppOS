package llm

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	"github.com/websoft9/appos/backend/domain/secrets"
)

// GetProviders loads the LLM providers list from custom_settings.
func GetProviders(app core.App) (map[string]any, error) {
	return sysconfig.GetGroup(app, SettingsModule, ProvidersSettingsKey, DefaultProviders())
}

// GetProvidersMasked loads providers and masks sensitive apiKey fields.
func GetProvidersMasked(app core.App) (map[string]any, error) {
	v, err := GetProviders(app)
	if err != nil {
		return maskProviders(DefaultProviders()), err
	}
	return maskProviders(v), nil
}

// SetProviders writes the LLM providers list to custom_settings.
func SetProviders(app core.App, value map[string]any) error {
	return sysconfig.SetGroup(app, SettingsModule, ProvidersSettingsKey, value)
}

// PatchProviders merges incoming data with existing (preserving "***" apiKey
// sentinels), validates secret refs, persists, and returns the masked result.
func PatchProviders(app core.App, userID string, incoming map[string]any) (map[string]any, error) {
	existing, _ := GetProviders(app)
	merged := preserveAPIKeys(incoming, existing)

	if err := ValidateProviderSecretRefs(app, userID, merged); err != nil {
		return nil, &ValidationError{Field: "items", Message: err.Error()}
	}

	if err := SetProviders(app, merged); err != nil {
		return nil, err
	}

	stored, _ := GetProviders(app)
	return maskProviders(stored), nil
}

// ValidateProviderSecretRefs checks that every provider item whose apiKey uses
// a secretRef pointer references a valid, accessible secret.
func ValidateProviderSecretRefs(app core.App, userID string, value map[string]any) error {
	items, _ := value["items"].([]any)
	for i, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		apiKey, _ := m["apiKey"].(string)
		if id, ok := secrets.ExtractSecretID(apiKey); ok {
			if err := secrets.ValidateRef(app, id, userID); err != nil {
				return fmt.Errorf("provider[%d].apiKey secretRef invalid: %v", i, err)
			}
		}
	}
	return nil
}

// ─── Mask / preserve helpers ───────────────────────────────────────────────

// maskProviders masks apiKey fields in the providers value map.
func maskProviders(v map[string]any) map[string]any {
	items, ok := v["items"].([]any)
	if !ok {
		return v
	}
	out := make([]any, len(items))
	for i, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			out[i] = item
			continue
		}
		clone := make(map[string]any, len(m))
		for k, val := range m {
			clone[k] = val
		}
		if s, ok := clone["apiKey"].(string); ok && s != "" {
			if !secrets.IsSecretRef(s) {
				clone["apiKey"] = "***"
			}
		}
		out[i] = clone
	}
	return map[string]any{"items": out}
}

// preserveAPIKeys replaces "***" sentinel values in incoming items with the
// corresponding stored apiKey values from existing.
func preserveAPIKeys(incoming, existing map[string]any) map[string]any {
	inArr, ok := incoming["items"].([]any)
	if !ok {
		return incoming
	}
	exArr, _ := existing["items"].([]any)
	out := make([]any, len(inArr))
	for i, item := range inArr {
		inItem, ok := item.(map[string]any)
		if !ok {
			out[i] = item
			continue
		}
		apiKey, _ := inItem["apiKey"].(string)
		if apiKey == "***" {
			exItem := findMatchingProvider(inItem, exArr, i)
			if stored, ok := exItem["apiKey"]; ok {
				inItem["apiKey"] = stored
			}
		}
		out[i] = inItem
	}
	incoming["items"] = out
	return incoming
}

// findMatchingProvider locates the best existing item by non-sensitive field match
// or falls back to positional index.
func findMatchingProvider(incoming map[string]any, exArr []any, posHint int) map[string]any {
	for _, ex := range exArr {
		exItem, ok := ex.(map[string]any)
		if !ok {
			continue
		}
		if fieldsMatch(incoming, exItem) {
			return exItem
		}
	}
	if posHint < len(exArr) {
		if exItem, ok := exArr[posHint].(map[string]any); ok {
			return exItem
		}
	}
	return map[string]any{}
}

func fieldsMatch(a, b map[string]any) bool {
	matched := 0
	for k, v := range a {
		if k == "apiKey" {
			continue
		}
		if bv, ok := b[k]; !ok || fmt.Sprint(v) != fmt.Sprint(bv) {
			return false
		}
		matched++
	}
	return matched > 0
}

// ─── Validation error ──────────────────────────────────────────────────────

// ValidationError is returned when provider data fails validation.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string { return e.Message }
