package routes

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// registerCatalogRoutes registers canonical App Catalog read routes under /api/catalog.
//
// This is the backend skeleton for Story 5.7. Handlers currently return 501 until
// the normalized catalog projection is implemented.
func registerCatalogRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	catalog := g.Group("/catalog")

	catalog.GET("/categories", handleCatalogCategories)

	apps := catalog.Group("/apps")
	apps.GET("", handleCatalogAppsList)
	apps.GET("/{key}", handleCatalogAppDetail)
	apps.GET("/{key}/deploy-source", handleCatalogAppDeploySource)
}

func handleCatalogCategories(e *core.RequestEvent) error {
	return catalogNotImplemented(e, "categories")
}

func handleCatalogAppsList(e *core.RequestEvent) error {
	return catalogNotImplemented(e, "apps.list")
}

func handleCatalogAppDetail(e *core.RequestEvent) error {
	return catalogNotImplemented(e, "apps.detail")
}

func handleCatalogAppDeploySource(e *core.RequestEvent) error {
	return catalogNotImplemented(e, "apps.deploy-source")
}

func catalogNotImplemented(e *core.RequestEvent, endpoint string) error {
	return e.JSON(http.StatusNotImplemented, map[string]any{
		"code":     http.StatusNotImplemented,
		"message":  "catalog read API not implemented",
		"endpoint": endpoint,
	})
}