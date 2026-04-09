package tunnelpb

import (
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/audit"
	sec "github.com/websoft9/appos/backend/domain/secrets"
)

// TokenValidator resolves a raw tunnel token to a managed server ID using PocketBase.
type TokenValidator struct {
	App        core.App
	TokenCache *sync.Map
	PauseUntil func(*core.Record) time.Time
}

// Validate checks whether rawToken is a valid tunnel token and returns the associated managed server ID.
func (v *TokenValidator) Validate(rawToken string) (managedServerID string, ok bool) {
	if v == nil || v.App == nil {
		return "", false
	}
	repo := tunnelRepository{app: v.App}
	if v.TokenCache != nil {
		if sid, cached := v.TokenCache.Load(rawToken); cached {
			managedServerID = sid.(string)
			server, err := repo.findManagedServerRecord(managedServerID)
			if err != nil {
				v.TokenCache.Delete(rawToken)
				return "", false
			}
			if v.PauseUntil != nil {
				if pauseUntil := v.PauseUntil(server); pauseUntil.After(time.Now().UTC()) {
					writePausedConnectRejectedAudit(v.App, managedServerID, pauseUntil)
					return "", false
				}
			}
			return managedServerID, true
		}
	}

	return v.validateAndPopulateCache(rawToken)
}

func (v *TokenValidator) validateAndPopulateCache(rawToken string) (string, bool) {
	now := time.Now().UTC()
	repo := tunnelRepository{app: v.App}
	secrets, err := repo.findTunnelTokenSecrets()
	if err != nil {
		return "", false
	}

	var matchedManagedServerID string
	matched := false

	for _, secret := range secrets {
		dec, err := sec.ReadSystemSingleValue(sec.From(secret))
		if err != nil || dec == "" {
			continue
		}

		managedServerID, err := repo.resolveManagedServerID(secret)
		if err != nil || managedServerID == "" {
			continue
		}

		if v.TokenCache != nil {
			v.TokenCache.Store(dec, managedServerID)
		}
		if dec == rawToken {
			matchedManagedServerID = managedServerID
			matched = true
		}
	}

	if !matched {
		return "", false
	}

	server, err := repo.findManagedServerRecord(matchedManagedServerID)
	if err != nil {
		if v.TokenCache != nil {
			v.TokenCache.Delete(rawToken)
		}
		return "", false
	}
	if v.PauseUntil != nil {
		if pauseUntil := v.PauseUntil(server); pauseUntil.After(now) {
			writePausedConnectRejectedAudit(v.App, matchedManagedServerID, pauseUntil)
			return "", false
		}
	}
	return matchedManagedServerID, true
}

func writePausedConnectRejectedAudit(app core.App, managedServerID string, pauseUntil time.Time) {
	audit.Write(app, audit.Entry{
		UserID:       "system",
		Action:       "tunnel.connect_rejected",
		ResourceType: "server",
		ResourceID:   managedServerID,
		Status:       audit.StatusSuccess,
		Detail: map[string]any{
			"reason":       "paused",
			"reason_label": "Rejected while paused",
			"pause_until":  pauseUntil.Format(time.RFC3339),
		},
	})
}
