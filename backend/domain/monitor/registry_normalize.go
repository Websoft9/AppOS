package monitor

import (
	"fmt"
	"strings"

	"github.com/websoft9/appos/backend/domain/resource/instances"
)

func normalizeTargetRegistryEntry(entry TargetRegistryEntry) (TargetRegistryEntry, error) {
	entry.ID = strings.TrimSpace(entry.ID)
	entry.TargetType = strings.TrimSpace(strings.ToLower(entry.TargetType))
	entry.Kind = strings.TrimSpace(strings.ToLower(entry.Kind))
	entry.SignalSources = normalizeStringSlice(entry.SignalSources)
	entry.EnabledChecks = normalizeStringSlice(entry.EnabledChecks)
	entry.TemplateIDs = normalizeTemplateIDs(entry.TemplateIDs)
	entry.StatusPriority = normalizeStatusPriorityMap(entry.StatusPriority)
	if entry.Checks.Reachability != nil {
		entry.Checks.Reachability.StatusMap = normalizeStatusMap(entry.Checks.Reachability.StatusMap)
		entry.Checks.Reachability.ReasonMap = normalizeReasonMap(entry.Checks.Reachability.ReasonMap)
		entry.Checks.Reachability.ReasonCodeMap = normalizeReasonMap(entry.Checks.Reachability.ReasonCodeMap)
	}
	if entry.Checks.Credential != nil {
		entry.Checks.Credential.StatusMap = normalizeStatusMap(entry.Checks.Credential.StatusMap)
		entry.Checks.Credential.ReasonMap = normalizeReasonMap(entry.Checks.Credential.ReasonMap)
		entry.Checks.Credential.ReasonCodeMap = normalizeReasonMap(entry.Checks.Credential.ReasonCodeMap)
	}
	if entry.Checks.AppHealth != nil {
		entry.Checks.AppHealth.StatusMap = normalizeStatusMap(entry.Checks.AppHealth.StatusMap)
		entry.Checks.AppHealth.ReasonMap = normalizeReasonMap(entry.Checks.AppHealth.ReasonMap)
		entry.Checks.AppHealth.ReasonCodeMap = normalizeReasonMap(entry.Checks.AppHealth.ReasonCodeMap)
	}
	if entry.Checks.Runtime != nil {
		entry.Checks.Runtime.StatusMap = normalizeStatusMap(entry.Checks.Runtime.StatusMap)
		entry.Checks.Runtime.ReasonMap = normalizeReasonMap(entry.Checks.Runtime.ReasonMap)
		entry.Checks.Runtime.ReasonCodeMap = normalizeReasonMap(entry.Checks.Runtime.ReasonCodeMap)
	}
	if entry.ID == "" {
		return TargetRegistryEntry{}, fmt.Errorf("registry entry id is required")
	}
	if entry.TargetType == "" {
		return TargetRegistryEntry{}, fmt.Errorf("registry entry %q targetType is required", entry.ID)
	}
	return entry, nil
}

func normalizeStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(strings.ToLower(value))
		if trimmed == "" {
			continue
		}
		if containsNormalized(result, trimmed) {
			continue
		}
		result = append(result, trimmed)
	}
	return result
}

func normalizeTemplateIDs(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		normalized := instances.NormalizeTemplateID(value)
		if normalized == "" || containsNormalized(result, normalized) {
			continue
		}
		result = append(result, normalized)
	}
	return result
}

func normalizeStatusMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		normalizedKey := strings.TrimSpace(strings.ToLower(key))
		normalizedValue := strings.TrimSpace(strings.ToLower(value))
		if normalizedKey == "" || normalizedValue == "" {
			continue
		}
		result[normalizedKey] = normalizedValue
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func normalizeReasonMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		normalizedKey := strings.TrimSpace(strings.ToLower(key))
		normalizedValue := strings.TrimSpace(value)
		if normalizedKey == "" || normalizedValue == "" {
			continue
		}
		result[normalizedKey] = normalizedValue
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func normalizeStatusPriorityMap(values map[string]int) map[string]int {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]int, len(values))
	for key, value := range values {
		normalizedKey := strings.TrimSpace(strings.ToLower(key))
		if normalizedKey == "" {
			continue
		}
		result[normalizedKey] = value
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func containsNormalized(values []string, expected string) bool {
	expected = strings.TrimSpace(strings.ToLower(expected))
	for _, value := range values {
		if strings.TrimSpace(strings.ToLower(value)) == expected {
			return true
		}
	}
	return false
}
