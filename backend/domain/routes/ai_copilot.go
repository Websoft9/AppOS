package routes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/ai/copilot"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/infra/persistence"
)

var aiCopilotModelFactory copilot.ModelFactory

type routeSecretResolver struct {
	app core.App
}

func (r routeSecretResolver) Resolve(_ context.Context, secretID, actorID string) (*secrets.ResolveResult, error) {
	return secrets.Resolve(r.app, secretID, actorID)
}

func registerAICopilotRoutes(se *core.ServeEvent) {
	group := se.Router.Group("/api/ai/copilot")
	group.Bind(apis.RequireSuperuserAuth())
	group.GET("/sessions", handleAICopilotListSessions)
	group.POST("/sessions", handleAICopilotCreateSession)
	group.PATCH("/sessions/{sessionId}", handleAICopilotUpdateSession)
	group.DELETE("/sessions/{sessionId}", handleAICopilotDeleteSession)
	group.GET("/sessions/{sessionId}/messages", handleAICopilotListMessages)
	group.POST("/sessions/{sessionId}/messages", handleAICopilotSendMessage)
}

func newAICopilotService(app core.App) *copilot.Service {
	repo := persistence.NewAICopilotRepository(app)
	providers := persistence.NewAIProviderRepository(app)
	resolver := copilot.NewDefaultProviderResolver(providers, routeSecretResolver{app: app})
	return copilot.NewService(repo, resolver, resolveAICopilotModelFactory(app))
}

func resolveAICopilotModelFactory(app core.App) copilot.ModelFactory {
	if aiCopilotModelFactory != nil {
		return aiCopilotModelFactory
	}
	return copilot.EinoModelFactory{App: app}
}

func handleAICopilotListSessions(e *core.RequestEvent) error {
	userID, _ := authInfo(e)
	sessions, err := newAICopilotService(e.App).ListSessions(e.Request.Context(), userID)
	if err != nil {
		return aiCopilotError(e, err)
	}
	return e.JSON(http.StatusOK, map[string]any{"items": sessions})
}

func handleAICopilotCreateSession(e *core.RequestEvent) error {
	var body struct {
		Title string `json:"title"`
	}
	if err := e.BindBody(&body); err != nil {
		return aiCopilotError(e, &copilot.CodedError{Code: copilot.CodeInvalidRequest, Message: "invalid request body", Cause: err})
	}
	userID, _ := authInfo(e)
	session, err := newAICopilotService(e.App).CreateSession(e.Request.Context(), userID, body.Title)
	if err != nil {
		return aiCopilotError(e, err)
	}
	return e.JSON(http.StatusCreated, session)
}

func handleAICopilotListMessages(e *core.RequestEvent) error {
	userID, _ := authInfo(e)
	messages, err := newAICopilotService(e.App).ListMessages(e.Request.Context(), e.Request.PathValue("sessionId"), userID)
	if err != nil {
		return aiCopilotError(e, err)
	}
	return e.JSON(http.StatusOK, map[string]any{"items": messages})
}

func handleAICopilotUpdateSession(e *core.RequestEvent) error {
	var body struct {
		Title string `json:"title"`
	}
	if err := e.BindBody(&body); err != nil {
		return aiCopilotError(e, &copilot.CodedError{Code: copilot.CodeInvalidRequest, Message: "invalid request body", Cause: err})
	}
	userID, _ := authInfo(e)
	session, err := newAICopilotService(e.App).UpdateSession(e.Request.Context(), e.Request.PathValue("sessionId"), userID, body.Title)
	if err != nil {
		return aiCopilotError(e, err)
	}
	return e.JSON(http.StatusOK, session)
}

func handleAICopilotDeleteSession(e *core.RequestEvent) error {
	userID, _ := authInfo(e)
	if err := newAICopilotService(e.App).DeleteSession(e.Request.Context(), e.Request.PathValue("sessionId"), userID); err != nil {
		return aiCopilotError(e, err)
	}
	return e.NoContent(http.StatusNoContent)
}

func handleAICopilotSendMessage(e *core.RequestEvent) error {
	var body struct {
		Content     string                   `json:"content"`
		ProviderID  string                   `json:"provider_id,omitempty"`
		Model       string                   `json:"model,omitempty"`
		Attachments []copilot.MessageAttachment `json:"attachments"`
	}
	if err := e.BindBody(&body); err != nil {
		return aiCopilotError(e, &copilot.CodedError{Code: copilot.CodeInvalidRequest, Message: "invalid request body", Cause: err})
	}
	flusher, ok := e.Response.(http.Flusher)
	if !ok {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": copilot.CodeRuntimeFailed, "message": "streaming unsupported"})
	}

	e.Response.Header().Set("Content-Type", "text/event-stream")
	e.Response.Header().Set("Cache-Control", "no-cache")
	e.Response.Header().Set("Connection", "keep-alive")

	push := func(event string, payload map[string]any) error {
		data, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		if _, err := fmt.Fprintf(e.Response, "event: %s\n", event); err != nil {
			return err
		}
		if _, err := fmt.Fprintf(e.Response, "data: %s\n\n", string(data)); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}

	userID, _ := authInfo(e)
	assistant, err := newAICopilotService(e.App).SendMessage(e.Request.Context(), e.Request.PathValue("sessionId"), userID, body.Content, body.ProviderID, body.Model, body.Attachments, func(chunk string) error {
		return push("chunk", map[string]any{"content": chunk})
	})
	if err != nil {
		var coded *copilot.CodedError
		code := copilot.CodeRuntimeFailed
		message := err.Error()
		if errors.As(err, &coded) {
			code = coded.Code
			message = coded.Error()
		}
		_ = push("error", map[string]any{"code": code, "message": message})
		return nil
	}
	return push("done", map[string]any{"message": assistant})
}

func aiCopilotError(e *core.RequestEvent, err error) error {
	var coded *copilot.CodedError
	if errors.As(err, &coded) {
		status := http.StatusBadRequest
		switch coded.Code {
		case copilot.CodeSessionNotFound:
			status = http.StatusNotFound
		case copilot.CodeProviderSetupRequired:
			status = http.StatusFailedDependency
		case copilot.CodeRuntimeFailed:
			status = http.StatusBadGateway
		}
		return e.JSON(status, map[string]any{"code": coded.Code, "message": coded.Message})
	}
	return e.JSON(http.StatusInternalServerError, map[string]any{"code": "internal_error", "message": err.Error()})
}
