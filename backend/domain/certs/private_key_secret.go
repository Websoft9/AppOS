package certs

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

const (
	privateKeySecretField       = "private_key_secret"
	legacyPrivateKeySecretField = "key"
)

func getPrivateKeySecretID(record *core.Record) string {
	if record == nil {
		return ""
	}
	if id := strings.TrimSpace(record.GetString(privateKeySecretField)); id != "" {
		return id
	}
	return strings.TrimSpace(record.GetString(legacyPrivateKeySecretField))
}

func normalizePrivateKeySecretRef(record *core.Record) string {
	if record == nil {
		return ""
	}
	if id := strings.TrimSpace(record.GetString(privateKeySecretField)); id != "" {
		record.Set(legacyPrivateKeySecretField, id)
		return id
	}
	if id := strings.TrimSpace(record.GetString(legacyPrivateKeySecretField)); id != "" {
		record.Set(privateKeySecretField, id)
		return id
	}
	return ""
}

func setPrivateKeySecretID(record *core.Record, secretID string) {
	if record == nil {
		return
	}
	secretID = strings.TrimSpace(secretID)
	record.Set(privateKeySecretField, secretID)
	record.Set(legacyPrivateKeySecretField, secretID)
}
