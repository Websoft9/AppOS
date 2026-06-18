package remoteshell

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/secrets"
)

const selfProxyTokenPrefix = "self-proxy-token-"

func SelfProxyTokenSecretName(serverID string) string {
	return selfProxyTokenPrefix + strings.TrimSpace(serverID)
}

func GetOrIssueSelfProxyToken(app core.App, serverID string) (string, error) {
	name := SelfProxyTokenSecretName(serverID)
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

	token, err := generateSelfProxyToken()
	if err != nil {
		return "", err
	}
	_, err = secrets.UpsertSystemSingleValue(app, secret, name, "token", token)
	if err != nil {
		return "", err
	}
	return token, nil
}

func ReadSelfProxyToken(app core.App, serverID string) (string, error) {
	secret, err := secrets.FindSystemSecretByNameAndType(app, SelfProxyTokenSecretName(serverID), "token")
	if err != nil || secret == nil {
		return "", err
	}
	return secrets.ReadSystemSingleValue(secret)
}

func ConstantTimeTokenEqual(expected string, actual string) bool {
	expected = strings.TrimSpace(expected)
	actual = strings.TrimSpace(actual)
	if expected == "" || actual == "" || len(expected) != len(actual) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(actual)) == 1
}

func generateSelfProxyToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}