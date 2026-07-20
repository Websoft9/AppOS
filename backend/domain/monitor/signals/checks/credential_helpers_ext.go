package checks

import (
	"strconv"
	"strings"

	"github.com/websoft9/appos/backend/domain/secrets"
)

func firstCredentialString(payload map[string]any, keys ...string) (string, string) {
	for _, key := range keys {
		value := secrets.FirstStringFromPayload(payload, key)
		if value != "" {
			return value, key
		}
	}
	return "", ""
}

func stringConfigValue(config map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := config[key]
		if !ok {
			continue
		}
		text, ok := value.(string)
		if ok {
			text = strings.TrimSpace(text)
			if text != "" {
				return text
			}
		}
	}
	return ""
}

func intConfigValue(config map[string]any, defaultValue int, keys ...string) int {
	for _, key := range keys {
		value, ok := config[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case int:
			return typed
		case int32:
			return int(typed)
		case int64:
			return int(typed)
		case float64:
			return int(typed)
		case string:
			parsed, err := strconv.Atoi(strings.TrimSpace(typed))
			if err == nil {
				return parsed
			}
		}
	}
	return defaultValue
}

func summaryCredentialOutcome(status string) string {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case "healthy":
		return "success"
	case "credential_invalid":
		return "auth_failed"
	case "unreachable":
		return "unreachable"
	default:
		return "unknown"
	}
}

func isCredentialAuthError(err error) bool {
	message := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(message, "wrongpass") ||
		strings.Contains(message, "noauth") ||
		strings.Contains(message, "authentication failed") ||
		strings.Contains(message, "invalid password") ||
		strings.Contains(message, "denied") ||
		strings.Contains(message, "invalid username-password pair") ||
		strings.Contains(message, "client sent auth")
}
