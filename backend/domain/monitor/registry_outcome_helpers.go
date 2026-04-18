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
