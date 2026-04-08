package servers

import "github.com/pocketbase/pocketbase/core"

// CredentialAuthType infers the SSH auth type from a secret's template_id.
// single_value -> "password"; ssh_key -> "private_key".
func CredentialAuthType(app core.App, credID string) string {
	if credID == "" {
		return ""
	}
	rec, err := app.FindRecordById("secrets", credID)
	if err != nil {
		return ""
	}
	if rec.GetString("template_id") == "ssh_key" {
		return "private_key"
	}
	return "password"
}

// ResolveConfig looks up the server record + decrypted credential and returns
// a ConnectorConfig for server-level control flows.
//
// Credentials are decrypted via secrets.Resolve which supports both the new
// payload_encrypted format and the legacy value field for backward compatibility.
// Plaintext is never persisted.
func ResolveConfig(app core.App, auth *core.Record, serverID string) (ConnectorConfig, error) {
	userID := ""
	if auth != nil {
		userID = auth.Id
	}
	return ResolveConfigForUserID(app, serverID, userID)
}
