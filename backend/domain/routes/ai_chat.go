package routes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/ai/chat"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/infra/persistence"
)

var aiChatModelFactory chat.ModelFactory = chat.EinoModelFactory{}

type routeSecretResolver struct {
	app core.App
}

func (r routeSecretResolver) Resolve(_ context.Context, secretID, actorID string) (*secrets.ResolveResult, error) {
	return secrets.Resolve(r.app, secretID, actorID)
}

func registerAIChatRoutes(se *core.ServeEvent) {
	group := se.Router.Group("/api/ai/chat")
	group.Bind(apis.RequireSuperuserAuth())
	group.GET("/sessions", handleAIChatListSessions)
	group.POST("/sessions", handleAIChatCreateSession)
	group.PATCH("/sessions/{sessionId}", handleAIChatUpdateSession)
	group.DELETE("/sessions/{sessionId}", handleAIChatDeleteSession)
	group.GET("/sessions/{sessionId}/messages", handleAIChatListMessages)
	group.POST("/sessions/{sessionId}/messages", handleAIChatSendMessage)
}

func newAIChatService(app core.App) *chat.Service {
	repo := persistence.NewAIChatRepository(app)
	providers := persistence.NewAIProviderRepository(app)
	resolver := chat.NewDefaultProviderResolver(providers, routeSecretResolver{app: app})
	return chat.NewService(repo, resolver, aiChatModelFactory)
}

func handleAIChatListSessions(e *core.RequestEvent) error {
	userID, _ := authInfo(e)
	sessions, err := newAIChatService(e.App).ListSessions(e.Request.Context(), userID)
	if err != nil {
		return aiChatError(e, err)
	}
	return e.JSON(http.StatusOK, map[string]any{"items": sessions})
}

func handleAIChatCreateSession(e *core.RequestEvent) error {
	var body struct {
		Title string `json:"title"`
	}
	if err := e.BindBody(&body); err != nil {
		return aiChatError(e, &chat.CodedError{Code: chat.CodeInvalidRequest, Message: "invalid request body", Cause: err})
	}
	userID, _ := authInfo(e)
	session, err := newAIChatService(e.App).CreateSession(e.Request.Context(), userID, body.Title)
	if err != nil {
		return aiChatError(e, err)
	}
	return e.JSON(http.StatusCreated, session)
}

func handleAIChatListMessages(e *core.RequestEvent) error {
	userID, _ := authInfo(e)
	messages, err := newAIChatService(e.App).ListMessages(e.Request.Context(), e.Request.PathValue("sessionId"), userID)
	if err != nil {
		return aiChatError(e, err)
	}
	return e.JSON(http.StatusOK, map[string]any{"items": messages})
}

func handleAIChatUpdateSession(e *core.RequestEvent) error {
	var body struct {
		Title string `json:"title"`
	}
	if err := e.BindBody(&body); err != nil {
		return aiChatError(e, &chat.CodedError{Code: chat.CodeInvalidRequest, Message: "invalid request body", Cause: err})
	}
	userID, _ := authInfo(e)
	session, err := newAIChatService(e.App).UpdateSession(e.Request.Context(), e.Request.PathValue("sessionId"), userID, body.Title)
	if err != nil {
		return aiChatError(e, err)
	}
	return e.JSON(http.StatusOK, session)
}

func handleAIChatDeleteSession(e *core.RequestEvent) error {
	userID, _ := authInfo(e)
	if err := newAIChatService(e.App).DeleteSession(e.Request.Context(), e.Request.PathValue("sessionId"), userID); err != nil {
		return aiChatError(e, err)
	}
	return e.NoContent(http.StatusNoContent)
}

func handleAIChatSendMessage(e *core.RequestEvent) error {
	var body struct {
		Content     string                   `json:"content"`
		Attachments []chat.MessageAttachment `json:"attachments"`
	}
	if err := e.BindBody(&body); err != nil {
		return aiChatError(e, &chat.CodedError{Code: chat.CodeInvalidRequest, Message: "invalid request body", Cause: err})
	}
	flusher, ok := e.Response.(http.Flusher)
	if !ok {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": chat.CodeRuntimeFailed, "message": "streaming unsupported"})
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
	assistant, err := newAIChatService(e.App).SendMessage(e.Request.Context(), e.Request.PathValue("sessionId"), userID, body.Content, body.Attachments, func(chunk string) error {
		return push("chunk", map[string]any{"content": chunk})
	})
	if err != nil {
		var coded *chat.CodedError
		code := chat.CodeRuntimeFailed
		message := err.Error()
		if errors.As(err, &coded) {
			code = coded.Code
			message = coded.Message
		}
		_ = push("error", map[string]any{"code": code, "message": message})
		return nil
	}
	return push("done", map[string]any{"message": assistant})
}

func aiChatError(e *core.RequestEvent, err error) error {
	var coded *chat.CodedError
	if errors.As(err, &coded) {
		status := http.StatusBadRequest
		switch coded.Code {
		case chat.CodeSessionNotFound:
			status = http.StatusNotFound
		case chat.CodeProviderSetupRequired:
			status = http.StatusFailedDependency
		case chat.CodeRuntimeFailed:
			status = http.StatusBadGateway
		}
		return e.JSON(status, map[string]any{"code": coded.Code, "message": coded.Message})
	}
	return e.JSON(http.StatusInternalServerError, map[string]any{"code": "internal_error", "message": err.Error()})
}
