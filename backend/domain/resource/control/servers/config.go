package servers

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	sec "github.com/websoft9/appos/backend/domain/secrets"
)

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
	var cfg ConnectorConfig

	server, err := app.FindRecordById("servers", serverID)
	if err != nil {
		return cfg, fmt.Errorf("server not found: %w", err)
	}

	cfg.Host = server.GetString("host")
	cfg.Port = server.GetInt("port")
	if cfg.Port == 0 {
		cfg.Port = 22
	}
	cfg.User = server.GetString("user")
	cfg.Shell = server.GetString("shell")

	credID := server.GetString("credential")
	if credID != "" {
		cfg.AuthType = CredentialAuthType(app, credID)
		userID := ""
		if auth != nil {
			userID = auth.Id
		}
		result, resolveErr := sec.Resolve(app, credID, userID)
		if resolveErr != nil {
			return cfg, fmt.Errorf("credential resolve failed: %w", resolveErr)
		}
		switch cfg.AuthType {
		case "password":
			cfg.Secret = sec.FirstStringFromPayload(result.Payload, "password", "value")
		default:
			cfg.Secret = sec.FirstStringFromPayload(result.Payload, "private_key", "key", "value")
		}
		if cfg.Secret == "" {
			return cfg, fmt.Errorf("credential resolve: no usable value in payload for auth_type %q", cfg.AuthType)
		}
	}

	if strings.EqualFold(server.GetString("connect_type"), "tunnel") {
		var services []struct {
			Name       string `json:"service_name"`
			TunnelPort int    `json:"tunnel_port"`
		}
		_ = json.Unmarshal([]byte(server.GetString("tunnel_services")), &services)
		for _, svc := range services {
			if svc.Name == "ssh" && svc.TunnelPort > 0 {
				cfg.Host = "127.0.0.1"
				cfg.Port = svc.TunnelPort
				break
			}
		}
	}

	return cfg, nil
}
