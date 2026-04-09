package tunnelpb

import (
	"log"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/audit"
	tunnelcore "github.com/websoft9/appos/backend/infra/tunnelcore"
)

// SessionHooks persists session lifecycle facts into PocketBase.
type SessionHooks struct {
	App                   core.App
	Sessions              *tunnelcore.Registry
	DisconnectReasonLabel func(string) string
}

func (h *SessionHooks) OnConnect(managedServerID string, services []tunnelcore.Service, conflicts []tunnelcore.ConflictResolution) {
	repo := tunnelRepository{app: h.App}
	now := time.Now().UTC()
	remoteAddr := ""
	connectedAt := now
	if h.Sessions != nil {
		if sess, ok := h.Sessions.Get(managedServerID); ok {
			connectedAt = sess.ConnectedAt.UTC()
			if sess.Conn != nil && sess.Conn.RemoteAddr() != nil {
				remoteAddr = sess.Conn.RemoteAddr().String()
			}
		}
	}
	if err := repo.saveConnectedState(managedServerID, connectedAt, remoteAddr, services); err != nil {
		log.Printf("[tunnel] OnConnect: save server %s: %v", managedServerID, err)
	}

	for _, cr := range conflicts {
		audit.Write(h.App, audit.Entry{
			Action:       "tunnel.port_conflict_resolved",
			ResourceType: "server",
			ResourceID:   managedServerID,
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
		ResourceID:   managedServerID,
		Status:       audit.StatusSuccess,
		Detail: map[string]any{
			"services":       services,
			"services_count": len(services),
			"remote_addr":    remoteAddr,
			"connected_at":   connectedAt.Format(time.RFC3339),
		},
	})
}

func (h *SessionHooks) OnDisconnect(managedServerID string, reason tunnelcore.DisconnectReason) {
	if h.Sessions != nil {
		if _, active := h.Sessions.Get(managedServerID); active {
			return
		}
	}

	repo := tunnelRepository{app: h.App}
	disconnectAt := time.Now().UTC()
	_ = repo.saveDisconnectedState(managedServerID, reason, disconnectAt)

	reasonLabel := string(reason)
	if h.DisconnectReasonLabel != nil {
		reasonLabel = h.DisconnectReasonLabel(string(reason))
	}
	audit.Write(h.App, audit.Entry{
		Action:       "tunnel.disconnect",
		ResourceType: "server",
		ResourceID:   managedServerID,
		Status:       audit.StatusSuccess,
		Detail: map[string]any{
			"reason":        string(reason),
			"reason_label":  reasonLabel,
			"disconnect_at": disconnectAt.Format(time.RFC3339),
		},
	})
}
