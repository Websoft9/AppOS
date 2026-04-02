package tunnel

import (
	"context"
	"encoding/json"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/infra/crypto"
)

const TokenSecretPrefix = "tunnel-token-"

// TokenSecretName returns the canonical secret record name for a server tunnel token.
func TokenSecretName(serverID string) string {
	return TokenSecretPrefix + serverID
}

// FindTokenSecret loads the tunnel token secret for serverID, including the
// legacy servers.credential fallback used by older records.
func FindTokenSecret(app core.App, serverID string) (*core.Record, error) {
	secret, err := app.FindFirstRecordByFilter(
		"secrets",
		"type = 'tunnel_token' && name = {:name}",
		dbx.Params{"name": TokenSecretName(serverID)},
	)
	if err == nil {
		return secret, nil
	}

	server, sErr := app.FindRecordById("servers", serverID)
	if sErr != nil {
		return nil, nil
	}
	credID := server.GetString("credential")
	if credID == "" {
		return nil, nil
	}
	legacy, lErr := app.FindRecordById("secrets", credID)
	if lErr != nil {
		return nil, nil
	}
	if legacy.GetString("type") != "tunnel_token" {
		return nil, nil
	}
	return legacy, nil
}

// PBTokenValidator resolves a raw tunnel token to a server ID using PocketBase.
type PBTokenValidator struct {
	App        core.App
	TokenCache *sync.Map
	PauseUntil func(*core.Record) time.Time
}

// Validate checks whether rawToken is a valid tunnel token and returns the associated server ID.
func (v *PBTokenValidator) Validate(rawToken string) (serverID string, ok bool) {
	if v == nil || v.App == nil {
		return "", false
	}
	if v.TokenCache != nil {
		if sid, cached := v.TokenCache.Load(rawToken); cached {
			serverID := sid.(string)
			server, err := v.App.FindRecordById("servers", serverID)
			if err != nil {
				v.TokenCache.Delete(rawToken)
				return "", false
			}
			if v.PauseUntil != nil {
				if pauseUntil := v.PauseUntil(server); pauseUntil.After(time.Now().UTC()) {
					audit.Write(v.App, audit.Entry{
						UserID:       "system",
						Action:       "tunnel.connect_rejected",
						ResourceType: "server",
						ResourceID:   serverID,
						Status:       audit.StatusSuccess,
						Detail: map[string]any{
							"reason":       "paused",
							"reason_label": "Rejected while paused",
							"pause_until":  pauseUntil.Format(time.RFC3339),
						},
					})
					return "", false
				}
			}
			return serverID, true
		}
	}

	return v.validateAndPopulateCache(rawToken)
}

func (v *PBTokenValidator) validateAndPopulateCache(rawToken string) (string, bool) {
	now := time.Now().UTC()
	secrets, err := v.App.FindRecordsByFilter(
		"secrets",
		"type = 'tunnel_token' && value != ''",
		"", 0, 0,
	)
	if err != nil {
		return "", false
	}

	var matchedServerID string
	matched := false

	for _, secret := range secrets {
		dec, err := crypto.Decrypt(secret.GetString("value"))
		if err != nil || dec == "" {
			continue
		}

		sid := ""
		if name := secret.GetString("name"); strings.HasPrefix(name, TokenSecretPrefix) {
			sid = strings.TrimPrefix(name, TokenSecretPrefix)
		}
		if sid == "" {
			server, err := v.App.FindFirstRecordByFilter(
				"servers",
				"credential = {:cid} && connect_type = 'tunnel'",
				dbx.Params{"cid": secret.Id},
			)
			if err != nil {
				continue
			}
			sid = server.Id
		}

		if v.TokenCache != nil {
			v.TokenCache.Store(dec, sid)
		}
		if dec == rawToken {
			matchedServerID = sid
			matched = true
		}
	}

	if !matched {
		return "", false
	}

	server, err := v.App.FindRecordById("servers", matchedServerID)
	if err != nil {
		if v.TokenCache != nil {
			v.TokenCache.Delete(rawToken)
		}
		return "", false
	}
	if v.PauseUntil != nil {
		if pauseUntil := v.PauseUntil(server); pauseUntil.After(now) {
			audit.Write(v.App, audit.Entry{
				UserID:       "system",
				Action:       "tunnel.connect_rejected",
				ResourceType: "server",
				ResourceID:   matchedServerID,
				Status:       audit.StatusSuccess,
				Detail: map[string]any{
					"reason":       "paused",
					"reason_label": "Rejected while paused",
					"pause_until":  pauseUntil.Format(time.RFC3339),
				},
			})
			return "", false
		}
	}
	return matchedServerID, true
}

// PBForwardResolver loads desired forwards for a tunnel server from PocketBase.
type PBForwardResolver struct{ App core.App }

func (v *PBForwardResolver) Resolve(serverID string) []ForwardSpec {
	server, err := v.App.FindRecordById("servers", serverID)
	if err != nil {
		return DefaultForwardSpecs()
	}
	raw := server.GetString("tunnel_forwards")
	if raw == "" || raw == "null" {
		return DefaultForwardSpecs()
	}
	var forwards []ForwardSpec
	if err := json.Unmarshal([]byte(raw), &forwards); err != nil || len(forwards) == 0 {
		return DefaultForwardSpecs()
	}
	return forwards
}

// PBSessionHooks persists session lifecycle facts into PocketBase.
type PBSessionHooks struct {
	App                   core.App
	Sessions              *Registry
	DisconnectReasonLabel func(string) string
}

func (h *PBSessionHooks) OnConnect(serverID string, services []Service, conflicts []ConflictResolution) {
	server, err := h.App.FindRecordById("servers", serverID)
	if err != nil {
		log.Printf("[tunnel] OnConnect: server %s not found: %v", serverID, err)
		return
	}

	svcJSON, _ := json.Marshal(services)
	now := time.Now().UTC()
	remoteAddr := ""
	connectedAt := now
	if h.Sessions != nil {
		if sess, ok := h.Sessions.Get(serverID); ok {
			connectedAt = sess.ConnectedAt.UTC()
			if sess.Conn != nil && sess.Conn.RemoteAddr() != nil {
				remoteAddr = sess.Conn.RemoteAddr().String()
			}
		}
	}
	server.Set("tunnel_status", "online")
	server.Set("tunnel_last_seen", now)
	server.Set("tunnel_connected_at", connectedAt)
	server.Set("tunnel_remote_addr", remoteAddr)
	server.Set("tunnel_disconnect_at", nil)
	server.Set("tunnel_disconnect_reason", "")
	server.Set("tunnel_pause_until", nil)
	server.Set("tunnel_services", string(svcJSON))
	if err := h.App.Save(server); err != nil {
		log.Printf("[tunnel] OnConnect: save server %s: %v", serverID, err)
	}

	for _, cr := range conflicts {
		audit.Write(h.App, audit.Entry{
			Action:       "tunnel.port_conflict_resolved",
			ResourceType: "server",
			ResourceID:   serverID,
			Status:       audit.StatusSuccess,
			Detail: map[string]any{
				"service":  cr.ServiceName,
				"old_port": cr.OldPort,
				"new_port": cr.NewPort,
			},
		})
	}

	audit.Write(h.App, audit.Entry{
		Action:       "tunnel.connect",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		Detail: map[string]any{
			"services":       services,
			"services_count": len(services),
			"remote_addr":    remoteAddr,
			"connected_at":   connectedAt.Format(time.RFC3339),
		},
	})
}

func (h *PBSessionHooks) OnDisconnect(serverID string, reason DisconnectReason) {
	if h.Sessions != nil {
		if _, active := h.Sessions.Get(serverID); active {
			return
		}
	}

	server, err := h.App.FindRecordById("servers", serverID)
	if err != nil {
		return
	}
	disconnectAt := time.Now().UTC()
	server.Set("tunnel_status", "offline")
	server.Set("tunnel_disconnect_at", disconnectAt)
	server.Set("tunnel_disconnect_reason", string(reason))
	_ = h.App.Save(server)

	reasonLabel := string(reason)
	if h.DisconnectReasonLabel != nil {
		reasonLabel = h.DisconnectReasonLabel(string(reason))
	}
	audit.Write(h.App, audit.Entry{
		Action:       "tunnel.disconnect",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       audit.StatusSuccess,
		Detail: map[string]any{
			"reason":        string(reason),
			"reason_label":  reasonLabel,
			"disconnect_at": disconnectAt.Format(time.RFC3339),
		},
	})
}

// StartWithPocketBase builds and starts the reverse-SSH tunnel server using
// PocketBase-backed adapters. It keeps HTTP routing concerns outside this package.
func StartWithPocketBase(app core.App, sessions *Registry, tokenCache *sync.Map, pauseUntil func(*core.Record) time.Time, disconnectReasonLabel func(string) string) {
	portRange := LoadPortRange(app)
	pool := NewPortPool(portRange.Start, portRange.End)

	existingServers, _ := app.FindRecordsByFilter(
		"servers",
		"connect_type = 'tunnel'",
		"", 0, 0,
	)
	var portRecords []PortRecord
	for _, rec := range existingServers {
		raw := rec.GetString("tunnel_services")
		if raw == "" || raw == "null" {
			continue
		}
		var svcs []Service
		if err := json.Unmarshal([]byte(raw), &svcs); err == nil && len(svcs) > 0 {
			portRecords = append(portRecords, PortRecord{ServerID: rec.Id, Services: svcs})
		}
	}
	pool.LoadExisting(portRecords)

	validator := &PBTokenValidator{App: app, TokenCache: tokenCache, PauseUntil: pauseUntil}
	forwardResolver := &PBForwardResolver{App: app}
	hooks := &PBSessionHooks{App: app, Sessions: sessions, DisconnectReasonLabel: disconnectReasonLabel}

	srv := &Server{
		DataDir:         app.DataDir(),
		ListenAddr:      ":2222",
		Validator:       validator,
		Pool:            pool,
		ForwardResolver: forwardResolver,
		Sessions:        sessions,
		Hooks:           hooks,
	}

	go func() {
		if err := srv.ListenAndServe(context.Background()); err != nil {
			log.Printf("[tunnel] server stopped: %v", err)
		}
	}()
}
