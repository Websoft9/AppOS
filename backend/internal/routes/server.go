package routes

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/router"

	sec "github.com/websoft9/appos/backend/internal/secrets"
	servers "github.com/websoft9/appos/backend/internal/servers"
)

var wsUpgrader = websocket.Upgrader{
	// TODO: validate Origin header for production CSRF protection.
	CheckOrigin: func(r *http.Request) bool { return true },
}

// wsTokenAuth is a middleware that authenticates WebSocket upgrade requests
// using a "token" query parameter. Browsers cannot set custom headers on WS
// upgrade, so the frontend sends the JWT as ?token=.
func wsTokenAuth() *hook.Handler[*core.RequestEvent] {
	return &hook.Handler[*core.RequestEvent]{
		Id: "wsTokenAuth",
		Priority: -1019,
		Func: func(e *core.RequestEvent) error {
			if e.Auth != nil {
				return e.Next()
			}
			tok := e.Request.URL.Query().Get("token")
			if tok == "" {
				return e.Next()
			}
			record, err := e.App.FindAuthRecordByToken(tok, core.TokenTypeAuth)
			if err == nil && record != nil {
				e.Auth = record
			}
			return e.Next()
		},
	}
}

// registerServerRoutes registers server shell/files/ops/container routes.
func registerServerRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	g.Bind(wsTokenAuth())
	g.Bind(apis.RequireSuperuserAuth())

	registerServerShellRoutes(g)
	registerServerFileRoutes(g)
	registerServerContainerRoutes(g)
	registerServerOpsRoutes(g)
}

// credAuthType infers the SSH auth type from a secret's template_id.
// single_value → "password"; ssh_key → "private_key".
func credAuthType(app core.App, credID string) string {
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

// resolveServerConfig looks up the server record + decrypted credential and
// returns a ConnectorConfig.
//
// Credentials are decrypted via secrets.Resolve which supports both the new
// Epic-19 payload_encrypted format (AES-256-GCM, base64 JSON blob) and the
// legacy value field (AES-256-GCM, hex) for backward compatibility until the
// Story 19.4 migration runs. Plaintext is never persisted.
func resolveServerConfig(e *core.RequestEvent, serverID string) (servers.ConnectorConfig, error) {
	var cfg servers.ConnectorConfig

	server, err := e.App.FindRecordById("servers", serverID)
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
		// auth_type is inferred from the secret's template_id (field removed in Story 20.1).
		cfg.AuthType = credAuthType(e.App, credID)
		// Resolve credential: supports new payload_encrypted and legacy value formats.
		userID := ""
		if e.Auth != nil {
			userID = e.Auth.Id
		}
		payload, resolveErr := sec.Resolve(e.App, credID, userID)
		if resolveErr != nil {
			return cfg, fmt.Errorf("credential resolve failed: %w", resolveErr)
		}
		switch cfg.AuthType {
		case "password":
			cfg.Secret = sec.FirstStringFromPayload(payload, "password", "value")
		default: // private_key
			cfg.Secret = sec.FirstStringFromPayload(payload, "private_key", "key", "value")
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
