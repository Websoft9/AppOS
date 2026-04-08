package tunnelpb

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
	tunnelcore "github.com/websoft9/appos/backend/infra/tunnelcore"
)

type pbForwardResolver struct {
	load func(serverID string) ([]tunnelcore.ForwardSpec, error)
}

func (v *pbForwardResolver) Resolve(serverID string) []tunnelcore.ForwardSpec {
	if v == nil || v.load == nil {
		return tunnelcore.DefaultForwardSpecs()
	}
	forwards, err := v.load(serverID)
	if err != nil || len(forwards) == 0 {
		return tunnelcore.DefaultForwardSpecs()
	}
	return forwards
}

// Start builds and starts the reverse-SSH tunnel server using
// PocketBase-backed adapters. It keeps HTTP routing concerns outside the tunnel kernel.
func Start(app core.App, sessions *tunnelcore.Registry, tokenCache *sync.Map, pauseUntil func(*core.Record) time.Time, disconnectReasonLabel func(string) string, forwardLoader func(serverID string) ([]tunnelcore.ForwardSpec, error)) {
	portRange := LoadPortRange(app)
	pool := tunnelcore.NewPortPool(portRange.Start, portRange.End)

	store := serverStore{app: app}
	portRecords, err := store.loadExistingPortRecords()
	if err != nil {
		log.Printf("[tunnel] load existing port records: %v", err)
	}
	pool.LoadExisting(portRecords)

	validator := &TokenValidator{App: app, TokenCache: tokenCache, PauseUntil: pauseUntil}
	forwardResolver := &pbForwardResolver{load: forwardLoader}
	hooks := &SessionHooks{App: app, Sessions: sessions, DisconnectReasonLabel: disconnectReasonLabel}

	srv := &tunnelcore.Server{
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
