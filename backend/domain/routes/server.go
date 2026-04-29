package routes

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/router"
	backenddocker "github.com/websoft9/appos/backend/infra/docker"
	"github.com/websoft9/appos/backend/infra/netutil"
)

var wsUpgrader = websocket.Upgrader{
	// TODO: validate Origin header for production CSRF protection.
	CheckOrigin: func(r *http.Request) bool { return true },
}

var dockerBridgeIPv4Lookup = netutil.LookupInterfaceIPv4
var dockerBridgeGatewayLookup = lookupDockerBridgeGateway

func lookupDockerBridgeGateway(ctx context.Context) (string, error) {
	client := backenddocker.New(backenddocker.NewLocalExecutor(""))
	gateway, err := client.Exec(
		ctx,
		"network",
		"inspect",
		"bridge",
		"--format",
		"{{range .IPAM.Config}}{{.Gateway}}{{end}}",
	)
	if err != nil {
		return "", err
	}

	gateway = strings.TrimSpace(gateway)
	if gateway == "" {
		return "", fmt.Errorf("bridge network has no gateway")
	}

	return gateway, nil
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

	g.GET("/connection", handleServersView)
	g.GET("/local/docker-bridge", handleLocalDockerBridge)
	registerServerOpsRoutes(g)
}

func handleLocalDockerBridge(e *core.RequestEvent) error {
	address, err := dockerBridgeIPv4Lookup("docker0")
	if err == nil {
		return e.JSON(http.StatusOK, map[string]any{
			"interface": "docker0",
			"address":   address,
		})
	}

	address, err = dockerBridgeGatewayLookup(e.Request.Context())
	if err == nil {
		return e.JSON(http.StatusOK, map[string]any{
			"interface": "bridge",
			"address":   address,
		})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"interface": "loopback",
		"address":   "127.0.0.1",
	})
}

// registerTerminalRoutes registers all interactive terminal session routes.
// Mounted at /api/terminal; uses wsTokenAuth for WebSocket handshake support.
func registerTerminalRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	registerServerShellRoutes(g)
	registerServerFileRoutes(g)
	registerServerContainerRoutes(g)
	registerLocalTerminalRoutes(g)
}
