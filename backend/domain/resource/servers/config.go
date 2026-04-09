package servers

import (
	"github.com/pocketbase/pocketbase/core"
)

// AccessAuthType identifies the credential material needed to reach a managed server.
type AccessAuthType string

const (
	// AuthMethodPassword authenticates with a username/password pair.
	AuthMethodPassword AccessAuthType = "password"
	// AuthMethodPrivateKey authenticates with an SSH private key.
	AuthMethodPrivateKey AccessAuthType = "private_key"
)

// AccessConfig is the servers bounded-context representation of how to reach a managed server.
type AccessConfig struct {
	Host     string
	Port     int
	User     string
	AuthType AccessAuthType
	Secret   string
	Shell    string
}

// CredentialAuthType infers the SSH auth type from a secret's template_id.
// single_value -> AuthMethodPassword; ssh_key -> AuthMethodPrivateKey.
func CredentialAuthType(app core.App, credID string) AccessAuthType {
	if credID == "" {
		return ""
	}
	rec, err := app.FindRecordById("secrets", credID)
	if err != nil {
		return ""
	}
	if rec.GetString("template_id") == "ssh_key" {
		return AuthMethodPrivateKey
	}
	return AuthMethodPassword
}

// ResolveConfig looks up the server record + decrypted credential and returns
// an AccessConfig for server-level control flows.
//
// Credentials are decrypted via secrets.Resolve which supports both the new
// payload_encrypted format and the legacy value field for backward compatibility.
// Plaintext is never persisted.
func ResolveConfig(app core.App, auth *core.Record, serverID string) (AccessConfig, error) {
	userID := ""
	if auth != nil {
		userID = auth.Id
	}
	return ResolveConfigForUserID(app, serverID, userID)
}
