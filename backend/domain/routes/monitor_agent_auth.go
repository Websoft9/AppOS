package routes

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/secrets"
)

// Keep the stored secret prefix stable so existing managed collectors do not
// need a token rotation when internal naming becomes collector-neutral.
const monitorCollectorTokenPrefix = "monitor-agent-token-"

func monitorCollectorTokenSecretName(serverID string) string {
	return monitorCollectorTokenPrefix + strings.TrimSpace(serverID)
}

func getOrIssueMonitorCollectorToken(app core.App, serverID string) (string, error) {
	name := monitorCollectorTokenSecretName(serverID)
	secret, err := secrets.FindSystemSecretByNameAndType(app, name, "token")
	if err == nil && secret != nil {
		value, readErr := secrets.ReadSystemSingleValue(secret)
		if readErr != nil {
			return "", readErr
		}
		if strings.TrimSpace(value) != "" {
			return value, nil
		}
	}

	token, err := generateMonitorCollectorToken()
	if err != nil {
		return "", err
	}
	_, err = secrets.UpsertSystemSingleValue(app, secret, name, "token", token)
	if err != nil {
		return "", err
	}
	return token, nil
}

func readMonitorCollectorToken(app core.App, serverID string) (string, error) {
	secret, err := secrets.FindSystemSecretByNameAndType(app, monitorCollectorTokenSecretName(serverID), "token")
	if err != nil || secret == nil {
		return "", err
	}
	return secrets.ReadSystemSingleValue(secret)
}

func generateMonitorCollectorToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func constantTimeTokenEqual(expected string, actual string) bool {
	expected = strings.TrimSpace(expected)
	actual = strings.TrimSpace(actual)
	if expected == "" || actual == "" || len(expected) != len(actual) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(actual)) == 1
}
