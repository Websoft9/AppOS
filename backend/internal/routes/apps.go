package routes

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// registerAppRoutes registers application lifecycle routes.
//
// Endpoints:
//
//	POST   /api/appos/apps/deploy      — deploy a new application
//	POST   /api/appos/apps/{id}/restart — restart an application
//	POST   /api/appos/apps/{id}/stop    — stop an application
//	DELETE /api/appos/apps/{id}         — delete an application
//	GET    /api/appos/apps/{id}/logs    — stream application logs
//	GET    /api/appos/apps/{id}/env     — get app environment variables
//	PUT    /api/appos/apps/{id}/env     — update app environment variables
func registerAppRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	apps := g.Group("/apps")

	apps.POST("/deploy", handleAppDeploy)
	apps.POST("/{id}/restart", handleAppRestart)
	apps.POST("/{id}/stop", handleAppStop)
	apps.DELETE("/{id}", handleAppDelete)
	apps.GET("/{id}/logs", handleAppLogs)
	apps.GET("/{id}/env", handleAppGetEnv)
	apps.PUT("/{id}/env", handleAppSetEnv)
}

func handleAppDeploy(e *core.RequestEvent) error {
	// TODO: validate request, create deployment record, enqueue Asynq task
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

func handleAppRestart(e *core.RequestEvent) error {
	// TODO: enqueue restart task
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

func handleAppStop(e *core.RequestEvent) error {
	// TODO: enqueue stop task
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

func handleAppDelete(e *core.RequestEvent) error {
	// TODO: enqueue delete task
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

func handleAppLogs(e *core.RequestEvent) error {
	// TODO: stream docker logs via SSE or chunked response
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

func handleAppGetEnv(e *core.RequestEvent) error {
	// TODO: read app environment variables
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}

func handleAppSetEnv(e *core.RequestEvent) error {
	// TODO: update app environment variables
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}
