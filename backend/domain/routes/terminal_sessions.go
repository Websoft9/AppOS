package routes

import (
	"encoding/json"
	"net/http"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/websoft9/appos/backend/domain/terminal"
)

func registerTerminalSessionRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	g.GET("/sessions", handleTerminalSessions)
	g.DELETE("/sessions/{sessionId}", handleTerminalSessionClose)
	g.PATCH("/sessions/{sessionId}/workspace", handleTerminalSessionWorkspace)
}

// handleTerminalSessions lists active in-memory terminal sessions owned by the current user.
// Mounted at /api/terminal/sessions.
// @Summary List terminal sessions
// @Description Returns active in-memory terminal session summaries owned by the current authenticated user.
// @Tags Terminal
// @Security BearerAuth
// @Success 200 {object} map[string]any "items: terminal session summaries"
// @Failure 401 {object} map[string]any
// @Router /api/terminal/sessions [get]
func handleTerminalSessions(e *core.RequestEvent) error {
	if e.Auth == nil {
		return e.JSON(http.StatusUnauthorized, map[string]any{"message": "The request requires valid record authorization token."})
	}

	items := terminal.ListSummariesByUser(e.Auth.Id)
	return e.JSON(http.StatusOK, map[string]any{"items": items})
}

// @Summary Update terminal session workspace snapshot
// @Description Stores the current file manager workspace snapshot for an active terminal session owned by the current authenticated user.
// @Tags Terminal
// @Security BearerAuth
// @Param sessionId path string true "terminal session ID"
// @Param body body terminal.TerminalWorkspaceSnapshot true "workspace snapshot payload"
// @Success 200 {object} map[string]any "ok"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/terminal/sessions/{sessionId}/workspace [patch]
func handleTerminalSessionWorkspace(e *core.RequestEvent) error {
	if e.Auth == nil {
		return e.JSON(http.StatusUnauthorized, map[string]any{"message": "The request requires valid record authorization token."})
	}

	sessionID := e.Request.PathValue("sessionId")
	if sessionID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "sessionId required"})
	}

	var body terminal.TerminalWorkspaceSnapshot
	if err := json.NewDecoder(e.Request.Body).Decode(&body); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "invalid workspace payload"})
	}

	if err := terminal.UpdateWorkspace(sessionID, e.Auth.Id, body); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	return e.JSON(http.StatusOK, map[string]any{"ok": true})
}

// @Summary Close terminal session
// @Description Explicitly closes an active terminal session owned by the current authenticated user.
// @Tags Terminal
// @Security BearerAuth
// @Param sessionId path string true "terminal session ID"
// @Success 200 {object} map[string]any "ok"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/terminal/sessions/{sessionId} [delete]
func handleTerminalSessionClose(e *core.RequestEvent) error {
	if e.Auth == nil {
		return e.JSON(http.StatusUnauthorized, map[string]any{"message": "The request requires valid record authorization token."})
	}

	sessionID := e.Request.PathValue("sessionId")
	if sessionID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "sessionId required"})
	}

	if err := terminal.CloseOwned(sessionID, e.Auth.Id); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	return e.JSON(http.StatusOK, map[string]any{"ok": true})
}
