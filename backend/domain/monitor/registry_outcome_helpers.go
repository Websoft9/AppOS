package monitor

import "strings"

func statusForOutcome(statusMap map[string]string, outcome string, fallback func(string) string) string {
	normalizedOutcome := strings.TrimSpace(strings.ToLower(outcome))
	if normalizedOutcome != "" {
		if mapped, ok := statusMap[normalizedOutcome]; ok && mapped != "" {
			return mapped
		}
	}
	return fallback(normalizedOutcome)
}

// reasonForOutcome resolves the human-readable reason string for the given outcome.
// Priority: non-empty fallback string > registry reasonMap entry > defaultReason.
// Callers that supply a runtime-specific message via fallback (e.g. a probe error
// description) intentionally override the generic registry defaults.
func reasonForOutcome(reasonMap map[string]string, outcome string, fallback string, defaultReason func(string) string) string {
	trimmedFallback := strings.TrimSpace(fallback)
	if trimmedFallback != "" {
		return trimmedFallback
	}
	normalizedOutcome := strings.TrimSpace(strings.ToLower(outcome))
	if normalizedOutcome != "" && reasonMap != nil {
		if mapped, ok := reasonMap[normalizedOutcome]; ok && mapped != "" {
			return mapped
		}
	}
	return defaultReason(normalizedOutcome)
}

// reasonCodeForOutcome follows the same priority as reasonForOutcome:
// non-empty fallback first, then map lookup, then defaultReasonCode.
func reasonCodeForOutcome(reasonCodeMap map[string]string, outcome string, fallback string, defaultReasonCode func(string) string) string {
	trimmedFallback := strings.TrimSpace(fallback)
	if trimmedFallback != "" {
		return trimmedFallback
	}
	normalizedOutcome := strings.TrimSpace(strings.ToLower(outcome))
	if normalizedOutcome != "" && reasonCodeMap != nil {
		if mapped, ok := reasonCodeMap[normalizedOutcome]; ok && mapped != "" {
			return mapped
		}
	}
	return defaultReasonCode(normalizedOutcome)
}
