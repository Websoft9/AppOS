package routes

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
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
	CheckOrigin: allowWebSocketOrigin,
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

func allowWebSocketOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return false
	}
	requestScheme := resolveWebSocketHTTPScheme(r)
	if !strings.EqualFold(parsed.Scheme, requestScheme) {
		return false
	}
	return sameWebSocketOriginHost(parsed.Host, resolveWebSocketHTTPHost(r), requestScheme)
}

func resolveWebSocketHTTPScheme(r *http.Request) string {
	if strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https") || r.TLS != nil {
		return "https"
	}
	return "http"
}

func resolveWebSocketHTTPHost(r *http.Request) string {
	host := firstForwardedHostValue(r.Host)
	forwardedHost := firstForwardedHostValue(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = forwardedHost
	}
	if forwardedHost != "" && forwardedHostCarriesPort(host, forwardedHost) {
		host = forwardedHost
	}
	if !hostHasExplicitPort(host) {
		if forwardedPort := firstForwardedPortValue(r.Header.Get("X-Forwarded-Port")); forwardedPort != "" {
			host = appendPortIfMissing(host, forwardedPort)
		}
	}
	return host
}

func sameWebSocketOriginHost(originHost string, requestHost string, scheme string) bool {
	if !strings.EqualFold(stripOptionalPort(originHost), stripOptionalPort(requestHost)) {
		return false
	}
	return effectivePort(originHost, scheme) == effectivePort(requestHost, scheme)
}

func effectivePort(host string, scheme string) string {
	if host == "" {
		return defaultPortForScheme(scheme)
	}
	if strings.HasPrefix(host, "[") {
		if idx := strings.LastIndex(host, "]:"); idx >= 0 {
			return host[idx+2:]
		}
		return defaultPortForScheme(scheme)
	}
	idx := strings.LastIndex(host, ":")
	if idx <= 0 || strings.Contains(host[:idx], ":") {
		return defaultPortForScheme(scheme)
	}
	port := host[idx+1:]
	for _, ch := range port {
		if ch < '0' || ch > '9' {
			return defaultPortForScheme(scheme)
		}
	}
	return port
}

func defaultPortForScheme(scheme string) string {
	if strings.EqualFold(strings.TrimSpace(scheme), "https") {
		return "443"
	}
	return "80"
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
