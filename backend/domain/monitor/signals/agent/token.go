package agent

import (
	"crypto/rand"
	"database/sql"
	"encoding/base32"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/secrets"
)

var tokenEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

func GenerateAgentToken() string {
	b := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		panic("monitor: failed to read random bytes: " + err.Error())
	}
	return tokenEncoding.EncodeToString(b)
}

func AgentTokenSecretName(serverID string) string {
	return monitor.AgentTokenSecretPrefix + strings.TrimSpace(serverID)
}

func GetOrIssueAgentToken(app core.App, serverID string, rotate bool) (token string, changed bool, err error) {
	name := AgentTokenSecretName(serverID)
	secret, err := secrets.FindSystemSecretByNameAndType(app, name, monitor.AgentTokenSecretType)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", false, err
	}
	if errors.Is(err, sql.ErrNoRows) {
		secret = nil
	}
	if secret != nil && !rotate {
		token, err = secrets.ReadSystemSingleValue(secret)
		return token, false, err
	}

	plaintext := GenerateAgentToken()
	_, err = secrets.UpsertSystemSingleValue(app, secret, name, monitor.AgentTokenSecretType, plaintext)
	if err != nil {
		return "", false, err
	}
	return plaintext, true, nil
}

func ValidateAgentToken(app core.App, plaintext string) (string, error) {
	if strings.TrimSpace(plaintext) == "" {
		return "", fmt.Errorf("missing token")
	}
	records, err := app.FindRecordsByFilter(
		"secrets",
		"created_source = {:source} && template_id = {:template} && type = {:type}",
		"",
		500,
		0,
		map[string]any{
			"source":   secrets.CreatedSourceSystem,
			"template": secrets.TemplateSingleValue,
			"type":     monitor.AgentTokenSecretType,
		},
	)
	if err != nil {
		return "", err
	}
	for _, record := range records {
		secret := secrets.From(record)
		value, readErr := secrets.ReadSystemSingleValue(secret)
		if readErr != nil {
			return "", readErr
		}
		if value == plaintext {
			name := strings.TrimSpace(record.GetString("name"))
			if !strings.HasPrefix(name, monitor.AgentTokenSecretPrefix) {
				return "", fmt.Errorf("invalid monitor token secret naming")
			}
			serverID := strings.TrimPrefix(name, monitor.AgentTokenSecretPrefix)
			if serverID == "" {
				return "", fmt.Errorf("invalid monitor token secret naming")
			}
			return serverID, nil
		}
	}
	return "", fmt.Errorf("invalid token")
}
