package routes

import (
	"net/http"

	"github.com/gorilla/websocket"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/router"
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
		Id:       "wsTokenAuth",
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

// registerServerRoutes registers server catalog/ops routes (non-terminal).
// These handle connectivity checks, power, ports, and systemd operations.
func registerServerRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	g.Bind(apis.RequireSuperuserAuth())

	registerServerOpsRoutes(g)
}

// registerTerminalRoutes registers all interactive terminal session routes.
// Mounted at /api/terminal; uses wsTokenAuth for WebSocket handshake support.
func registerTerminalRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	registerServerShellRoutes(g)
	registerServerFileRoutes(g)
	registerServerContainerRoutes(g)
	registerLocalTerminalRoutes(g)
}
