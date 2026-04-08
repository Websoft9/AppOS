package certs

import (
	"fmt"
	"log"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/secrets"
)

// StorePrivateKeySecret creates a new secret record containing the PEM private key,
// encrypting it via the secrets module. Returns the new secret record ID.
func StorePrivateKeySecret(app core.App, certRecord *core.Record, keyPEM string) (string, error) {
	payload := map[string]any{"private_key": keyPEM}
	secret, err := secrets.UpsertSystemPayloadSecret(app, nil, certRecord.GetString("name")+"-key", "tls_private_key", payload)
	if err != nil {
		return "", fmt.Errorf("save secret record: %w", err)
	}

	return secret.ID(), nil
}

// UpdatePrivateKeySecret re-encrypts the private key in an existing secret record.
func UpdatePrivateKeySecret(app core.App, secretID string, keyPEM string) error {
	rec, err := app.FindRecordById("secrets", secretID)
	if err != nil {
		return fmt.Errorf("find secret %s: %w", secretID, err)
	}

	payload := map[string]any{"private_key": keyPEM}
	if _, err := secrets.UpsertSystemPayloadSecret(app, secrets.From(rec), rec.GetString("name"), "tls_private_key", payload); err != nil {
		return fmt.Errorf("save secret record: %w", err)
	}

	return nil
}

// deleteSecretBestEffort attempts to delete a secret record, logging errors.
func deleteSecretBestEffort(app core.App, secretID string) {
	rec, err := app.FindRecordById("secrets", secretID)
	if err != nil {
		log.Printf("[WARN] certs: cleanup — could not find secret %s: %v", secretID, err)
		return
	}
	if err := app.Delete(rec); err != nil {
		log.Printf("[WARN] certs: cleanup — could not delete secret %s: %v", secretID, err)
	}
}
