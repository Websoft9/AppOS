package llm

import (
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// RegisterRoutes mounts LLM provider API routes. Requires superuser auth.
func RegisterRoutes(se *core.ServeEvent) {
	g := se.Router.Group("/api/llm")
	g.Bind(apis.RequireSuperuserAuth())
	g.GET("/providers", handleGetProviders)
	g.PATCH("/providers", handlePatchProviders)
}

// handleGetProviders returns the current LLM provider list with masked apiKeys.
//
// @Summary  Get LLM providers
// @Tags     LLM
// @Security BearerAuth
// @Success  200 {object} map[string]any
// @Router   /api/llm/providers [get]
func handleGetProviders(e *core.RequestEvent) error {
	value, _ := GetProvidersMasked(e.App)
	return e.JSON(http.StatusOK, value)
}

// handlePatchProviders updates LLM providers, preserving masked apiKeys and
// validating secret references.
//
// @Summary  Patch LLM providers
// @Tags     LLM
// @Security BearerAuth
// @Param    body body object true "LLM providers payload"
// @Success  200 {object} map[string]any
// @Failure  400 {object} map[string]any
// @Failure  422 {object} map[string]any
// @Router   /api/llm/providers [patch]
func handlePatchProviders(e *core.RequestEvent) error {
	var body map[string]any
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid JSON body", err)
	}

	userID := ""
	if e.Auth != nil {
		userID = e.Auth.Id
	}

	result, err := PatchProviders(e.App, userID, body)
	if err != nil {
		if ve, ok := err.(*ValidationError); ok {
			return e.JSON(http.StatusUnprocessableEntity, map[string]any{
				"errors": map[string]string{ve.Field: ve.Message},
			})
		}
		return e.BadRequestError("failed to update LLM providers", err)
	}

	return e.JSON(http.StatusOK, result)
}
