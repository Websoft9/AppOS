package routes

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"
)

// registerAuthRoutes registers unauthenticated auth helper routes.
//
// Endpoints:
//
//	POST /api/ext/auth/check-email — check if an email exists in _superusers or users
func registerAuthRoutes(se *core.ServeEvent) {
	auth := se.Router.Group("/api/ext/auth")

	auth.POST("/check-email", func(e *core.RequestEvent) error {
		var body struct {
			Email string `json:"email"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("Invalid request body", err)
		}
		if body.Email == "" {
			return e.BadRequestError("Email is required", nil)
		}

		// Check _superusers
		su, _ := e.App.FindAuthRecordByEmail("_superusers", body.Email)
		if su != nil {
			return e.JSON(http.StatusOK, map[string]any{
				"exists":     true,
				"collection": "_superusers",
			})
		}

		// Check users
		u, _ := e.App.FindAuthRecordByEmail("users", body.Email)
		if u != nil {
			return e.JSON(http.StatusOK, map[string]any{
				"exists":     true,
				"collection": "users",
			})
		}

		return e.JSON(http.StatusOK, map[string]any{
			"exists":     false,
			"collection": "",
		})
	})
}
