package routes

import (
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// registerProxyRoutes registers reverse proxy management routes.
// These routes require superuser authentication.
//
// Endpoints:
//
//	POST   /api/appos/proxy/domains              — add domain binding
//	GET    /api/appos/proxy/domains              — list domain bindings
//	DELETE /api/appos/proxy/domains/{domain}     — remove domain binding
//	POST   /api/appos/proxy/domains/{domain}/ssl — request SSL certificate
//	POST   /api/appos/proxy/reload               — reload proxy configuration
func registerProxyRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	proxy := g.Group("/proxy")
	proxy.Bind(apis.RequireSuperuserAuth())

	proxy.POST("/domains", handleProxyAddDomain)
	proxy.GET("/domains", handleProxyListDomains)
	proxy.DELETE("/domains/{domain}", handleProxyRemoveDomain)
	proxy.POST("/domains/{domain}/ssl", handleProxyRequestSSL)
	proxy.POST("/reload", handleProxyReload)
}

func handleProxyAddDomain(e *core.RequestEvent) error {
	// TODO: generate proxy config, add domain binding
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

func handleProxyListDomains(e *core.RequestEvent) error {
	// TODO: list all domain bindings
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

func handleProxyRemoveDomain(e *core.RequestEvent) error {
	// TODO: remove domain binding
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

func handleProxyRequestSSL(e *core.RequestEvent) error {
	// TODO: request SSL certificate for domain
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

func handleProxyReload(e *core.RequestEvent) error {
	// TODO: reload reverse proxy configuration
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}
