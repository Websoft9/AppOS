package tunnelpb

import (
	"sync"

	"github.com/pocketbase/pocketbase/core"
	sec "github.com/websoft9/appos/backend/domain/secrets"
	tunnelcore "github.com/websoft9/appos/backend/infra/tunnelcore"
)

type TokenIssueResult struct {
	Token   string
	Changed bool
	Rotated bool
}

// TokenService encapsulates tunnel token lookup, creation, and rotation.
type TokenService struct {
	App        core.App
	TokenCache *sync.Map
	Sessions   *tunnelcore.Registry
}

// Get returns the current tunnel token for a managed server if one exists.
func (s *TokenService) Get(managedServerID string) (string, bool, error) {
	repo := tunnelRepository{app: s.App}
	secret, err := repo.findTunnelTokenSecret(managedServerID)
	if err != nil {
		return "", false, err
	}
	if secret == nil {
		return "", false, nil
	}

	rawToken, err := sec.ReadSystemSingleValue(sec.From(secret))
	if err != nil {
		return "", false, err
	}
	return rawToken, true, nil
}

// GetOrIssue returns the current token unless rotation is requested, in which case it issues a fresh token.
func (s *TokenService) GetOrIssue(managedServerID string, wantRotate bool) (*TokenIssueResult, error) {
	repo := tunnelRepository{app: s.App}
	secret, err := repo.findTunnelTokenSecret(managedServerID)
	if err != nil {
		return nil, err
	}

	if secret != nil && !wantRotate {
		rawToken, _, err := s.Get(managedServerID)
		if err != nil {
			return nil, err
		}
		return &TokenIssueResult{Token: rawToken, Changed: false}, nil
	}

	rawToken := tunnelcore.Generate()

	rotating := secret != nil
	if rotating {
		s.invalidateCachedToken(secret)
		if err := repo.updateTunnelTokenSecret(secret, managedServerID, rawToken); err != nil {
			return nil, err
		}
		if wantRotate && s.Sessions != nil {
			s.Sessions.Disconnect(managedServerID, tunnelcore.DisconnectReasonTokenRotated)
		}
	} else {
		if err := repo.createTunnelTokenSecret(managedServerID, rawToken); err != nil {
			return nil, err
		}
	}

	if s.TokenCache != nil {
		s.TokenCache.Store(rawToken, managedServerID)
	}

	return &TokenIssueResult{Token: rawToken, Changed: true, Rotated: rotating}, nil
}

func (s *TokenService) invalidateCachedToken(secret *core.Record) {
	if s.TokenCache == nil || secret == nil {
		return
	}
	oldRawToken, err := sec.ReadSystemSingleValue(sec.From(secret))
	if err == nil && oldRawToken != "" {
		s.TokenCache.Delete(oldRawToken)
	}
}
