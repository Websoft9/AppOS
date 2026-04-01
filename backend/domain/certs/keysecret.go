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
	tpl, ok := secrets.FindTemplate("tls_private_key")
	if !ok {
		return "", fmt.Errorf("tls_private_key template not found in secrets")
	}

	payload := map[string]any{"private_key": keyPEM}

	enc, err := secrets.EncryptPayload(payload)
	if err != nil {
		return "", fmt.Errorf("encrypt private key: %w", err)
	}

	meta := secrets.BuildPayloadMeta(payload, tpl)

	col, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		return "", fmt.Errorf("find secrets collection: %w", err)
	}

	rec := core.NewRecord(col)
	rec.Set("name", certRecord.GetString("name")+"-key")
	rec.Set("template_id", "tls_private_key")
	rec.Set("payload_encrypted", enc)
	rec.Set("payload_meta", meta)
	rec.Set("version", 1)
	rec.Set("status", "active")
	rec.Set("created_by", "")

	if err := app.Save(rec); err != nil {
		return "", fmt.Errorf("save secret record: %w", err)
	}

	return rec.Id, nil
}

// UpdatePrivateKeySecret re-encrypts the private key in an existing secret record.
func UpdatePrivateKeySecret(app core.App, secretID string, keyPEM string) error {
	rec, err := app.FindRecordById("secrets", secretID)
	if err != nil {
		return fmt.Errorf("find secret %s: %w", secretID, err)
	}

	tpl, ok := secrets.FindTemplate("tls_private_key")
	if !ok {
		return fmt.Errorf("tls_private_key template not found in secrets")
	}

	payload := map[string]any{"private_key": keyPEM}

	enc, err := secrets.EncryptPayload(payload)
	if err != nil {
		return fmt.Errorf("encrypt private key: %w", err)
	}

	meta := secrets.BuildPayloadMeta(payload, tpl)

	rec.Set("payload_encrypted", enc)
	rec.Set("payload_meta", meta)
	rec.Set("version", rec.GetInt("version")+1)

	if err := app.Save(rec); err != nil {
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
