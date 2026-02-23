package routes

import (
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/internal/audit"
)

// registerUserRoutes registers superuser-only user management ext routes.
//
// Routes:
//   - POST /api/ext/users/{collection}/{id}/reset-password — admin force-reset a user's password
func registerUserRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	users := g.Group("/users")
	users.Bind(apis.RequireSuperuserAuth())

	// POST /api/ext/users/{collection}/{id}/reset-password
	// Admin directly sets a user's password without requiring the current password or email.
	// Works for both "users" and "_superusers" collections.
	// On success, PocketBase invalidates all existing tokens for that record.
	users.POST("/{collection}/{id}/reset-password", handleAdminResetPassword)
}

func handleAdminResetPassword(e *core.RequestEvent) error {
	collection := e.Request.PathValue("collection")
	id := e.Request.PathValue("id")

	// Only allow known auth collections
	if collection != "users" && collection != "_superusers" {
		return apis.NewBadRequestError("invalid collection; must be 'users' or '_superusers'", nil)
	}

	var body struct {
		Password        string `json:"password"`
		PasswordConfirm string `json:"passwordConfirm"`
	}
	if err := e.BindBody(&body); err != nil {
		return apis.NewBadRequestError("invalid request body", err)
	}
	if body.Password == "" {
		return apis.NewBadRequestError("password is required", nil)
	}
	if body.Password != body.PasswordConfirm {
		return apis.NewBadRequestError("passwords do not match", nil)
	}

	record, err := e.App.FindRecordById(collection, id)
	if err != nil {
		return apis.NewNotFoundError("user not found", err)
	}

	record.SetPassword(body.Password)
	ip := e.RealIP()
	ua := e.Request.Header.Get("User-Agent")
	if err := e.App.Save(record); err != nil {
		userID, userEmail := authInfo(e)
		audit.Write(e.App, audit.Entry{
			UserID: userID, UserEmail: userEmail,
			Action: "user.reset_password", ResourceType: "user",
			ResourceID: record.Id, ResourceName: record.GetString("email"),
			IP: ip, UserAgent: ua,
			Status: audit.StatusFailed,
			Detail: map[string]any{"errorMessage": err.Error()},
		})
		return apis.NewBadRequestError("failed to update password", err)
	}

	userID, userEmail := authInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID: userID, UserEmail: userEmail,
		Action: "user.reset_password", ResourceType: "user",
		ResourceID: record.Id, ResourceName: record.GetString("email"),
		IP: ip, UserAgent: ua,
		Status: audit.StatusSuccess,
	})
	return e.JSON(http.StatusOK, map[string]bool{"success": true})
}
