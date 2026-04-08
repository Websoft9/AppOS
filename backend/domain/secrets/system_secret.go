package secrets

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
)

const TemplateSingleValue = "single_value"

// FindSystemSecretByNameAndType loads a system-managed secret record by its canonical name and type.
func FindSystemSecretByNameAndType(app core.App, name, secretType string) (*Secret, error) {
	record, err := app.FindFirstRecordByFilter(
		"secrets",
		"name = {:name} && type = {:type}",
		map[string]any{"name": name, "type": secretType},
	)
	if err != nil {
		return nil, err
	}
	secret := From(record)
	if !secret.IsSystemManaged() {
		return nil, nil
	}
	return secret, nil
}

// ReadSystemSingleValue reads the plaintext of a system-managed single-value secret.
func ReadSystemSingleValue(secret *Secret) (string, error) {
	if secret == nil || secret.Record() == nil {
		return "", nil
	}
	return DecryptLegacyValue(secret.Record().GetString("value"))
}

// UpsertSystemSingleValue creates or updates a system-managed single-value secret using the legacy value field.
func UpsertSystemSingleValue(app core.App, secret *Secret, name, secretType, plaintext string) (*Secret, error) {
	encValue, err := EncryptLegacyValue(plaintext)
	if err != nil {
		return nil, err
	}

	var record *core.Record
	if secret != nil {
		record = secret.Record()
	} else {
		col, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return nil, err
		}
		record = core.NewRecord(col)
	}

	record.Set("name", name)
	record.Set("type", secretType)
	record.Set("template_id", TemplateSingleValue)
	record.Set("created_source", CreatedSourceSystem)
	record.Set("value", encValue)
	if err := app.Save(record); err != nil {
		return nil, err
	}
	return From(record), nil
}

// UpsertSystemPayloadSecret creates or updates a system-managed encrypted-payload secret.
func UpsertSystemPayloadSecret(app core.App, secret *Secret, name, templateID string, payload map[string]any) (*Secret, error) {
	tpl, ok := FindTemplate(templateID)
	if !ok {
		return nil, fmt.Errorf("invalid template_id")
	}
	if err := ValidatePayload(payload, tpl); err != nil {
		return nil, err
	}

	enc, err := EncryptPayload(payload)
	if err != nil {
		return nil, err
	}
	meta := BuildPayloadMeta(payload, tpl)

	var record *core.Record
	if secret != nil {
		record = secret.Record()
	} else {
		col, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return nil, err
		}
		record = core.NewRecord(col)
		record.Set("version", 1)
	}

	if secret != nil {
		record.Set("version", record.GetInt("version")+1)
	}
	record.Set("name", name)
	record.Set("template_id", templateID)
	record.Set("payload_encrypted", enc)
	record.Set("payload_meta", meta)
	record.Set("status", StatusActive)
	record.Set("created_source", CreatedSourceSystem)
	record.Set("created_by", "")
	record.Set("payload", nil)
	if err := app.Save(record); err != nil {
		return nil, err
	}
	return From(record), nil
}
