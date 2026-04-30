package routes

import (
	"errors"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	sharedshare "github.com/websoft9/appos/backend/domain/share"
	"github.com/websoft9/appos/backend/domain/topics"
)

type topicShareCreateRequest struct {
	Minutes int `json:"minutes"`
}

type topicShareCreateResponse struct {
	ShareToken string `json:"share_token"`
	ExpiresAt  string `json:"expires_at"`
}

type topicShareCommentRequest struct {
	Body      string `json:"body"`
	GuestName string `json:"guest_name"`
}

type topicShareCommentDocument struct {
	ID        string `json:"id"`
	Body      string `json:"body"`
	CreatedBy string `json:"created_by"`
	Created   string `json:"created"`
	Updated   string `json:"updated"`
}

type topicShareResolveResponse struct {
	ID          string                      `json:"id"`
	Title       string                      `json:"title"`
	Description string                      `json:"description"`
	Closed      bool                        `json:"closed"`
	Created     string                      `json:"created"`
	Updated     string                      `json:"updated"`
	ExpiresAt   string                      `json:"expires_at"`
	Comments    []topicShareCommentDocument `json:"comments"`
}

type topicShareCommentResponse struct {
	ID        string `json:"id"`
	Body      string `json:"body"`
	CreatedBy string `json:"created_by"`
	Created   string `json:"created"`
}

var (
	_ = topicShareCreateResponse{}
	_ = topicShareCommentDocument{}
	_ = topicShareResolveResponse{}
	_ = topicShareCommentResponse{}
)

// ─── Route registration ────────────────────────────────────────────────────

// registerTopicRoutes registers authenticated topic routes under /api/topics.
func registerTopicRoutes(se *core.ServeEvent) {
	g := se.Router.Group("/api/topics")
	g.Bind(apis.RequireAuth())

	g.POST("/share/{id}", handleTopicShareCreate)
	g.DELETE("/share/{id}", handleTopicShareRevoke)
}

// registerTopicPublicRoutes registers unauthenticated topic share routes.
func registerTopicPublicRoutes(se *core.ServeEvent) {
	pub := se.Router.Group("/api/topics")
	pub.GET("/share/{token}", handleTopicShareResolve)
	pub.POST("/share/{token}/comments", handleTopicShareComment)
}

// ─── Handlers ──────────────────────────────────────────────────────────────

// handleTopicShareCreate creates or refreshes a share token on a topics record.
//
// @Summary Create topic share link
// @Description Creates or refreshes a public share token for a topic owned by the authenticated user.
// @Tags Topics
// @Security BearerAuth
// @Param id path string true "topic id"
// @Param body body topicShareCreateRequest true "share token options"
// @Success 200 {object} topicShareCreateResponse
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/topics/share/{id} [post]
func handleTopicShareCreate(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")

	record, err := e.App.FindRecordById(topics.Collection, id)
	if err != nil {
		return e.NotFoundError("Topic not found", err)
	}

	t := topics.From(record)
	if !t.IsOwnedBy(e.Auth) {
		return e.ForbiddenError("Access denied", nil)
	}

	cfg := topics.GetShareConfig(e.App)

	var body topicShareCreateRequest
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid request body", err)
	}

	issuedShare, err := sharedshare.NewToken(body.Minutes, cfg.MaxMinutes, cfg.DefaultMinutes)
	if err != nil {
		if errors.Is(err, sharedshare.ErrDurationTooLong) {
			return e.BadRequestError(sharedshare.MessageForError(err), nil)
		}
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": "failed to generate share token"})
	}

	t.ApplyShare(issuedShare)
	if err := t.Save(e.App); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": "failed to save share token"})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"share_token": issuedShare.Value(),
		"expires_at":  issuedShare.ExpiresAt().Format(time.RFC3339),
	})
}

// handleTopicShareRevoke clears the share token on a topics record.
//
// @Summary Revoke topic share link
// @Description Revokes the current public share token for a topic owned by the authenticated user.
// @Tags Topics
// @Security BearerAuth
// @Param id path string true "topic id"
// @Success 204 {object} nil
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/topics/share/{id} [delete]
func handleTopicShareRevoke(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")

	record, err := e.App.FindRecordById(topics.Collection, id)
	if err != nil {
		return e.NotFoundError("Topic not found", err)
	}

	t := topics.From(record)
	if !t.IsOwnedBy(e.Auth) {
		return e.ForbiddenError("Access denied", nil)
	}

	t.RevokeShare()
	if err := t.Save(e.App); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": "failed to revoke share"})
	}

	return e.NoContent(http.StatusNoContent)
}

// handleTopicShareResolve is a public endpoint that returns topic data + comments
// for a valid share token.
//
// @Summary Resolve topic share link
// @Description Resolves a public share token and returns the topic with its visible comments.
// @Tags Topics
// @Param token path string true "share token"
// @Success 200 {object} topicShareResolveResponse
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/topics/share/{token} [get]
func handleTopicShareResolve(e *core.RequestEvent) error {
	token := e.Request.PathValue("token")

	record, err := e.App.FindFirstRecordByData(topics.Collection, "share_token", token)
	if err != nil || record == nil {
		return e.NotFoundError("Share link not found", nil)
	}

	t := topics.From(record)
	if err := t.ValidateShareActive(); err != nil {
		return e.JSON(http.StatusForbidden, map[string]any{"message": sharedshare.MessageForError(err)})
	}

	comments, err := e.App.FindRecordsByFilter(
		topics.CommentsCollection,
		"topic_id = {:topicId}",
		"created",
		500,
		0,
		map[string]any{"topicId": record.Id},
	)
	if err != nil {
		comments = nil
	}

	commentList := make([]map[string]any, 0, len(comments))
	for _, c := range comments {
		cm := topics.CommentFrom(c)
		commentList = append(commentList, map[string]any{
			"id":         cm.ID(),
			"body":       cm.Body(),
			"created_by": cm.CreatedBy(),
			"created":    cm.Created(),
			"updated":    cm.Updated(),
		})
	}

	expiresAt, _ := t.ShareExpiresAt()
	return e.JSON(http.StatusOK, map[string]any{
		"id":          t.ID(),
		"title":       t.Title(),
		"description": t.Description(),
		"closed":      t.IsClosed(),
		"created":     record.GetString("created"),
		"updated":     record.GetString("updated"),
		"expires_at":  expiresAt.Format(time.RFC3339),
		"comments":    commentList,
	})
}

// handleTopicShareComment allows anonymous comment posting on a shared topics.
//
// @Summary Create topic share comment
// @Description Creates an anonymous comment through a valid public share link.
// @Tags Topics
// @Param token path string true "share token"
// @Param body body topicShareCommentRequest true "comment payload"
// @Success 200 {object} topicShareCommentResponse
// @Failure 400 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/topics/share/{token}/comments [post]
func handleTopicShareComment(e *core.RequestEvent) error {
	token := e.Request.PathValue("token")

	record, err := e.App.FindFirstRecordByData(topics.Collection, "share_token", token)
	if err != nil || record == nil {
		return e.NotFoundError("Share link not found", nil)
	}

	t := topics.From(record)
	if err := t.ValidateShareActive(); err != nil {
		return e.JSON(http.StatusForbidden, map[string]any{"message": sharedshare.MessageForError(err)})
	}
	if err := t.EnsureOpen(); err != nil {
		return e.BadRequestError(topics.MessageForTopicError(err), nil)
	}

	var body topicShareCommentRequest
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid request body", err)
	}
	col, err := e.App.FindCollectionByNameOrId(topics.CommentsCollection)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": "internal error"})
	}
	cm, err := t.NewGuestComment(col, body.Body, body.GuestName)
	if err != nil {
		return e.BadRequestError(topics.MessageForTopicError(err), nil)
	}
	if err := cm.Save(e.App); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": "failed to save comment"})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":         cm.ID(),
		"body":       cm.Body(),
		"created_by": cm.CreatedBy(),
		"created":    cm.Created(),
	})
}
