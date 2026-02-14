package routes

import (
	"net/http"
	"os"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// registerSetupRoutes registers unauthenticated setup routes.
//
// Endpoints:
//
//	GET  /api/appos/setup/status — check if initial setup is needed
//	POST /api/appos/setup/init   — create first superuser (only when none exist)
func registerSetupRoutes(se *core.ServeEvent) {
	setup := se.Router.Group("/api/appos/setup")

	setup.GET("/status", func(e *core.RequestEvent) error {
		needsSetup, err := checkNeedsSetup(e)
		if err != nil {
			// On error, assume setup needed (safer default)
			return e.JSON(http.StatusOK, map[string]any{
				"needsSetup": true,
				"initMode":   getInitMode(),
			})
		}
		return e.JSON(http.StatusOK, map[string]any{
			"needsSetup": needsSetup,
			"initMode":   getInitMode(),
		})
	})

	setup.POST("/init", func(e *core.RequestEvent) error {
		// Only allow if no superusers exist
		needsSetup, err := checkNeedsSetup(e)
		if err != nil {
			return e.InternalServerError("", err)
		}
		if !needsSetup {
			return e.JSON(http.StatusForbidden, map[string]string{
				"error": "Setup already completed",
			})
		}

		var body struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("Invalid request body", err)
		}
		if body.Email == "" || body.Password == "" {
			return e.BadRequestError("Email and password are required", nil)
		}

		collection, err := e.App.FindCollectionByNameOrId("_superusers")
		if err != nil {
			return e.InternalServerError("", err)
		}

		record := core.NewRecord(collection)
		record.Set("email", body.Email)
		record.SetPassword(body.Password)

		if err := e.App.Save(record); err != nil {
			return e.BadRequestError("Failed to create superuser", err)
		}

		return e.JSON(http.StatusOK, map[string]string{
			"message": "Setup completed",
		})
	})
}

func checkNeedsSetup(e *core.RequestEvent) (bool, error) {
	// PocketBase auto-creates an installer superuser (__pbinstaller@example.com)
	// on fresh databases. Exclude it to match PB's own needInstallerSuperuser check.
	total, err := e.App.CountRecords("_superusers", dbx.Not(dbx.HashExp{
		"email": core.DefaultInstallerEmail,
	}))
	if err != nil {
		return false, err
	}
	return total == 0, nil
}

func getInitMode() string {
	mode := os.Getenv("INIT_MODE")
	if mode == "" {
		return "auto"
	}
	return mode
}
