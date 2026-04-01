package routes

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingscatalog "github.com/websoft9/appos/backend/domain/config/sysconfig/catalog"
)

// defaultTopicShareQuota is the code-level safety net when the DB row
// is missing. Mirrors the space share quota structure.
var defaultTopicShareQuota = settingscatalog.DefaultGroup("space", "quota")

// ─── Route registration ────────────────────────────────────────────────────

// registerTopicRoutes registers authenticated topic routes under /api/ext/topics.
func registerTopicRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	f := g.Group("/topics")
	f.Bind(apis.RequireAuth())

	f.POST("/share/{id}", handleTopicShareCreate)
	f.DELETE("/share/{id}", handleTopicShareRevoke)
}

// registerTopicPublicRoutes registers unauthenticated topic share routes.
func registerTopicPublicRoutes(se *core.ServeEvent) {
	pub := se.Router.Group("/api/ext/topics")
	pub.GET("/share/{token}", handleTopicShareResolve)
	pub.POST("/share/{token}/comments", handleTopicShareComment)
}

// ─── Handlers ──────────────────────────────────────────────────────────────

// handleTopicShareCreate creates or refreshes a share token on a topics record.
func handleTopicShareCreate(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")

	record, err := e.App.FindRecordById("topics", id)
	if err != nil {
		return e.NotFoundError("Topic not found", err)
	}

	authRecord := e.Auth
	if authRecord == nil || record.GetString("created_by") != authRecord.Id {
		return e.ForbiddenError("Access denied", nil)
	}

	quota, _ := sysconfig.GetGroup(e.App, "space", "quota", defaultTopicShareQuota)
	shareMaxMin := sysconfig.Int(quota, "shareMaxMinutes", 60)
	shareDefaultMin := sysconfig.Int(quota, "shareDefaultMinutes", 30)

	var body struct {
		Minutes int `json:"minutes"`
	}
	_ = e.BindBody(&body)
	if body.Minutes <= 0 {
		body.Minutes = shareDefaultMin
	}
	if body.Minutes > shareMaxMin {
		return e.BadRequestError(
			fmt.Sprintf("share duration cannot exceed %d minutes", shareMaxMin), nil,
		)
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": "failed to generate share token"})
	}
	token := hex.EncodeToString(tokenBytes)
	expiresAt := time.Now().UTC().Add(time.Duration(body.Minutes) * time.Minute)

	record.Set("share_token", token)
	record.Set("share_expires_at", expiresAt.Format(time.RFC3339))
	if err := e.App.Save(record); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": "failed to save share token"})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"share_token": token,
		"expires_at":  expiresAt.Format(time.RFC3339),
	})
}

// handleTopicShareRevoke clears the share token on a topics record.
func handleTopicShareRevoke(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")

	record, err := e.App.FindRecordById("topics", id)
	if err != nil {
		return e.NotFoundError("Topic not found", err)
	}

	authRecord := e.Auth
	if authRecord == nil || record.GetString("created_by") != authRecord.Id {
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

	record, err := e.App.FindFirstRecordByData("topics", "share_token", token)
	if err != nil || record == nil {
		return e.NotFoundError("Share link not found", nil)
	}

	if expired, reason := isTopicShareExpired(record); expired {
		return e.JSON(http.StatusForbidden, map[string]any{"message": reason})
	}

	// Fetch comments for this topic.
	comments, err := e.App.FindRecordsByFilter(
		"topic_comments",
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
		commentList = append(commentList, map[string]any{
			"id":         c.Id,
			"body":       c.GetString("body"),
			"created_by": c.GetString("created_by"),
			"created":    c.GetString("created"),
			"updated":    c.GetString("updated"),
		})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":          record.Id,
		"title":       record.GetString("title"),
		"description": record.GetString("description"),
		"closed":      record.GetBool("closed"),
		"created":     record.GetString("created"),
		"updated":     record.GetString("updated"),
		"expires_at":  record.GetString("share_expires_at"),
		"comments":    commentList,
	})
}

// handleTopicShareComment allows anonymous comment posting on a shared topic.
func handleTopicShareComment(e *core.RequestEvent) error {
	token := e.Request.PathValue("token")

	topic, err := e.App.FindFirstRecordByData("topics", "share_token", token)
	if err != nil || topic == nil {
		return e.NotFoundError("Share link not found", nil)
	}

	if expired, reason := isTopicShareExpired(topic); expired {
		return e.JSON(http.StatusForbidden, map[string]any{"message": reason})
	}

	if topic.GetBool("closed") {
		return e.BadRequestError("This topic is closed", nil)
	}

	var body struct {
		Body      string `json:"body"`
		GuestName string `json:"guest_name"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid request body", err)
	}
	if len(body.Body) == 0 || len(body.Body) > 10000 {
		return e.BadRequestError("Comment body is required (max 10000 chars)", nil)
	}
	guestName := body.GuestName
	if guestName == "" {
		guestName = "Guest"
	}
	if len(guestName) > 100 {
		return e.BadRequestError("Guest name too long (max 100 chars)", nil)
	}

	col, err := e.App.FindCollectionByNameOrId("topic_comments")
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": "internal error"})
	}

	comment := core.NewRecord(col)
	comment.Set("topic_id", topic.Id)
	comment.Set("body", body.Body)
	comment.Set("created_by", "guest:"+guestName)
	if err := e.App.Save(comment); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": "failed to save comment"})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":         comment.Id,
		"body":       comment.GetString("body"),
		"created_by": comment.GetString("created_by"),
		"created":    comment.GetString("created"),
	})
}

// ─── Helpers ───────────────────────────────────────────────────────────────

func isTopicShareExpired(record *core.Record) (bool, string) {
	raw := record.GetString("share_token")
	if raw == "" {
		return true, "share link has been revoked"
	}
	expiresRaw := record.GetString("share_expires_at")
	if expiresRaw == "" {
		return true, "share link has no expiry set"
	}
	expiresAt, err := time.Parse(time.RFC3339, expiresRaw)
	if err != nil {
		return true, "invalid share expiry"
	}
	if time.Now().UTC().After(expiresAt) {
		return true, "share link has expired"
	}
	return false, ""
}
