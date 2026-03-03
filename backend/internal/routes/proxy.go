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
//	POST   /api/ext/proxy/domains              — add domain binding
//	GET    /api/ext/proxy/domains              — list domain bindings
//	DELETE /api/ext/proxy/domains/{domain}     — remove domain binding
//	POST   /api/ext/proxy/domains/{domain}/ssl — request SSL certificate
//	POST   /api/ext/proxy/reload               — reload proxy configuration
func registerProxyRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	proxy := g.Group("/proxy")
	proxy.Bind(apis.RequireSuperuserAuth())

	proxy.POST("/domains", handleProxyAddDomain)
	proxy.GET("/domains", handleProxyListDomains)
	proxy.DELETE("/domains/{domain}", handleProxyRemoveDomain)
	proxy.POST("/domains/{domain}/ssl", handleProxyRequestSSL)
	proxy.POST("/reload", handleProxyReload)
}

// handleProxyAddDomain adds a domain binding to the reverse proxy configuration.
//
// @Summary Add proxy domain
// @Description Creates a new reverse proxy domain binding (virtual host). Superuser only.
// @Tags Settings
// @Security BearerAuth
// @Param body body object true "domain binding configuration"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/proxy/domains [post]
func handleProxyAddDomain(e *core.RequestEvent) error {
	// TODO: generate proxy config, add domain binding
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

// handleProxyListDomains returns all configured reverse proxy domain bindings.
//
// @Summary List proxy domains
// @Description Returns all active reverse proxy domain bindings. Superuser only.
// @Tags Settings
// @Security BearerAuth
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/proxy/domains [get]
func handleProxyListDomains(e *core.RequestEvent) error {
	// TODO: list all domain bindings
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

// handleProxyRemoveDomain removes a domain binding from the reverse proxy configuration.
//
// @Summary Remove proxy domain
// @Description Deletes a reverse proxy domain binding. Superuser only.
// @Tags Settings
// @Security BearerAuth
// @Param domain path string true "domain name to remove"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/proxy/domains/{domain} [delete]
func handleProxyRemoveDomain(e *core.RequestEvent) error {
	// TODO: remove domain binding
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

// handleProxyRequestSSL requests an SSL/TLS certificate for a domain via the configured ACME provider.
//
// @Summary Request SSL certificate
// @Description Triggers SSL certificate provisioning for the given domain. Superuser only.
// @Tags Settings
// @Security BearerAuth
// @Param domain path string true "domain to issue certificate for"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/proxy/domains/{domain}/ssl [post]
func handleProxyRequestSSL(e *core.RequestEvent) error {
	// TODO: request SSL certificate for domain
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

// handleProxyReload reloads the reverse proxy configuration without downtime.
//
// @Summary Reload proxy config
// @Description Sends a reload signal to the reverse proxy, applying pending configuration changes. Superuser only.
// @Tags Settings
// @Security BearerAuth
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/proxy/reload [post]
func handleProxyReload(e *core.RequestEvent) error {
	// TODO: reload reverse proxy configuration
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}
