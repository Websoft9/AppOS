package routes

import (
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/topic"
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
func handleTopicShareCreate(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")

	record, err := e.App.FindRecordById(topic.Collection, id)
	if err != nil {
		return e.NotFoundError("Topic not found", err)
	}

	t := topic.From(record)
	if !t.IsOwnedBy(e.Auth) {
		return e.ForbiddenError("Access denied", nil)
	}

	cfg := topic.GetShareConfig(e.App)

	var body struct {
		Minutes int `json:"minutes"`
	}
	_ = e.BindBody(&body)

	share, err := topic.NewShareToken(body.Minutes, cfg.MaxMinutes, cfg.DefaultMinutes)
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}

	record.Set("share_token", share.Token)
	record.Set("share_expires_at", share.ExpiresAt.Format(time.RFC3339))
	if err := e.App.Save(record); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": "failed to save share token"})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"share_token": share.Token,
		"expires_at":  share.ExpiresAt.Format(time.RFC3339),
	})
}

// handleTopicShareRevoke clears the share token on a topics record.
func handleTopicShareRevoke(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")

	record, err := e.App.FindRecordById(topic.Collection, id)
	if err != nil {
		return e.NotFoundError("Topic not found", err)
	}

	t := topic.From(record)
	if !t.IsOwnedBy(e.Auth) {
		return e.ForbiddenError("Access denied", nil)
	}

	record.Set("share_token", "")
	record.Set("share_expires_at", "")
	if err := e.App.Save(record); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": "failed to revoke share"})
	}

	return e.NoContent(http.StatusNoContent)
}

// handleTopicShareResolve is a public endpoint that returns topic data + comments
// for a valid share token.
func handleTopicShareResolve(e *core.RequestEvent) error {
	token := e.Request.PathValue("token")

	record, err := e.App.FindFirstRecordByData(topic.Collection, "share_token", token)
	if err != nil || record == nil {
		return e.NotFoundError("Share link not found", nil)
	}

	t := topic.From(record)
	if active, reason := t.ShareIsActive(); !active {
		return e.JSON(http.StatusForbidden, map[string]any{"message": reason})
	}

	comments, err := e.App.FindRecordsByFilter(
		topic.CommentsCollection,
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
		cm := topic.CommentFrom(c)
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

// handleTopicShareComment allows anonymous comment posting on a shared topic.
func handleTopicShareComment(e *core.RequestEvent) error {
	token := e.Request.PathValue("token")

	record, err := e.App.FindFirstRecordByData(topic.Collection, "share_token", token)
	if err != nil || record == nil {
		return e.NotFoundError("Share link not found", nil)
	}

	t := topic.From(record)
	if active, reason := t.ShareIsActive(); !active {
		return e.JSON(http.StatusForbidden, map[string]any{"message": reason})
	}
	if t.IsClosed() {
		return e.BadRequestError("This topic is closed", nil)
	}

	var body struct {
		Body      string `json:"body"`
		GuestName string `json:"guest_name"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid request body", err)
	}
	if len(body.Body) == 0 || len(body.Body) > topic.MaxCommentBodyLen {
		return e.BadRequestError("Comment body is required (max 10000 chars)", nil)
	}
	guestName := body.GuestName
	if guestName == "" {
		guestName = topic.DefaultGuestName
	}
	if len(guestName) > topic.MaxGuestNameLen {
		return e.BadRequestError("Guest name too long (max 100 chars)", nil)
	}

	col, err := e.App.FindCollectionByNameOrId(topic.CommentsCollection)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": "internal error"})
	}

	comment := core.NewRecord(col)
	comment.Set("topic_id", t.ID())
	comment.Set("body", body.Body)
	comment.Set("created_by", topic.GuestAuthorPrefix+guestName)
	if err := e.App.Save(comment); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": "failed to save comment"})
	}

	cm := topic.CommentFrom(comment)
	return e.JSON(http.StatusOK, map[string]any{
		"id":         cm.ID(),
		"body":       cm.Body(),
		"created_by": cm.CreatedBy(),
		"created":    cm.Created(),
	})
}
