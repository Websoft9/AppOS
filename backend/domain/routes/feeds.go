package routes

import (
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/feeds"
)

var pollFeedsNow = feeds.PollSources
var pollFeedSourceNow = feeds.PollSource
var analyzeFeedSource = feeds.AnalyzeSource

type feedItemStatePatchRequest struct {
	ReadState *string `json:"read_state"`
	IsStarred *bool   `json:"is_starred"`
}

type createBookmarkRequest struct {
	URL     string `json:"url"`
	Title   string `json:"title"`
	Summary string `json:"summary"`
}

type bookmarkConflictResponse struct {
	Code     string         `json:"code"`
	Message  string         `json:"message"`
	Existing map[string]any `json:"existing"`
}

type feedSourceAnalyzeRequest struct {
	URL string `json:"url"`
}

// registerFeedsRoutes registers authenticated feeds actions under /api/feeds.
func registerFeedsRoutes(se *core.ServeEvent) {
	g := se.Router.Group("/api/feeds")
	g.Bind(apis.RequireAuth())
	admin := se.Router.Group("/api/feeds")
	admin.Bind(apis.RequireSuperuserAuth())

	g.POST("/bookmarks", handleCreateBookmark)
	g.DELETE("/bookmarks/{id}", handleDeleteBookmark)
	g.PATCH("/items/{id}/state", handleFeedItemStatePatch)
	admin.POST("/analyze", handleFeedSourceAnalyze)
	admin.POST("/poll", handleFeedsPoll)
	admin.POST("/sources/{id}/poll", handleFeedSourcePoll)
}

// handleCreateBookmark stores one manual link as a bookmark-shaped feed item.
//
// @Summary Create bookmark item
// @Description Stores one manual link inside the Feeds workspace as a bookmark item. Authenticated users only.
// @Tags Feeds
// @Security BearerAuth
// @Param body body createBookmarkRequest true "bookmark payload"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/feeds/bookmarks [post]
func handleCreateBookmark(e *core.RequestEvent) error {
	var body createBookmarkRequest
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid JSON body", err)
	}

	if strings.TrimSpace(body.URL) == "" {
		return e.BadRequestError("bookmark url is required", nil)
	}

	normalized := feeds.NormalizeItem(feeds.ItemCandidate{
		Link:    body.URL,
		Title:   body.Title,
		Summary: body.Summary,
	})
	normalized.OriginType = feeds.OriginTypeBookmark
	normalized.IsStarred = false
	if normalized.Title == "" {
		normalized.Title = normalized.Link
	}

	existing, err := e.App.FindFirstRecordByFilter(feeds.CollectionItems, "origin_type = {:origin_type} && external_id = {:external_id}", map[string]any{
		"origin_type":  feeds.OriginTypeBookmark,
		"external_id": normalized.ExternalID,
	})
	if err == nil {
		return e.JSON(http.StatusConflict, bookmarkConflictResponse{
			Code:    "bookmark_exists",
			Message: "bookmark already exists",
			Existing: map[string]any{
				"id":          existing.Id,
				"origin_type": existing.GetString("origin_type"),
				"title":       existing.GetString("title"),
				"link":        existing.GetString("link"),
				"read_state":  existing.GetString("read_state"),
				"is_starred":  existing.GetBool("is_starred"),
			},
		})
	}

	itemsCol, err := e.App.FindCollectionByNameOrId(feeds.CollectionItems)
	if err != nil {
		return e.InternalServerError("failed to resolve feed items collection", err)
	}

	record := core.NewRecord(itemsCol)
	record.Set("origin_type", normalized.OriginType)
	record.Set("external_id", normalized.ExternalID)
	record.Set("title", normalized.Title)
	record.Set("link", normalized.Link)
	record.Set("summary", normalized.Summary)
	record.Set("read_state", normalized.ReadState)
	record.Set("is_starred", normalized.IsStarred)
	record.Set("source_id", nil)
	if err := e.App.Save(record); err != nil {
		return e.InternalServerError("failed to create bookmark", err)
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":          record.Id,
		"origin_type": record.GetString("origin_type"),
		"title":       record.GetString("title"),
		"link":        record.GetString("link"),
		"read_state":  record.GetString("read_state"),
		"is_starred":  record.GetBool("is_starred"),
	})
}

// handleDeleteBookmark removes one bookmark record without affecting article stars.
//
// @Summary Delete bookmark item
// @Description Deletes one bookmark item from the Feeds workspace. Authenticated users only.
// @Tags Feeds
// @Security BearerAuth
// @Param id path string true "bookmark item id"
// @Success 204 {string} string ""
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/feeds/bookmarks/{id} [delete]
func handleDeleteBookmark(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if strings.TrimSpace(id) == "" {
		return e.BadRequestError("bookmark item id is required", nil)
	}

	record, err := e.App.FindRecordById(feeds.CollectionItems, id)
	if err != nil {
		return e.NotFoundError("bookmark item not found", err)
	}
	if record.GetString("origin_type") != feeds.OriginTypeBookmark {
		return e.NotFoundError("bookmark item not found", nil)
	}

	if err := e.App.Delete(record); err != nil {
		return e.InternalServerError("failed to delete bookmark", err)
	}

	return e.NoContent(http.StatusNoContent)
}

// handleFeedSourceAnalyze fetches a feed URL and extracts minimal subscription metadata.
//
// @Summary Analyze feed source URL
// @Description Fetches one RSS or Atom URL and returns derived metadata for the subscription form. Superuser only.
// @Tags Feeds
// @Security BearerAuth
// @Param body body feedSourceAnalyzeRequest true "feed source analyze payload"
// @Success 200 {object} feeds.SourceAnalysis
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/feeds/analyze [post]
func handleFeedSourceAnalyze(e *core.RequestEvent) error {
	var body feedSourceAnalyzeRequest
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid JSON body", err)
	}

	url := strings.TrimSpace(body.URL)
	if url == "" {
		return e.BadRequestError("feed source url is required", nil)
	}

	analysis, err := analyzeFeedSource(nil, url, nil)
	if err != nil {
		return e.BadRequestError("failed to analyze feed source", err)
	}

	return e.JSON(http.StatusOK, analysis)
}

// handleFeedItemStatePatch updates the reader-owned preferences of one normalized feed item.
//
// @Summary Patch feed item preferences
// @Description Updates the reading preferences of a feed item without exposing direct write access to the underlying collection. Authenticated users only.
// @Tags Feeds
// @Security BearerAuth
// @Param id path string true "feed item id"
// @Param body body feedItemStatePatchRequest true "feed item state payload"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/feeds/items/{id}/state [patch]
func handleFeedItemStatePatch(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if strings.TrimSpace(id) == "" {
		return e.BadRequestError("feed item id is required", nil)
	}

	var body feedItemStatePatchRequest
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid JSON body", err)
	}

	if body.ReadState == nil && body.IsStarred == nil {
		return e.BadRequestError("at least one feed item preference is required", nil)
	}

	record, err := e.App.FindRecordById(feeds.CollectionItems, id)
	if err != nil {
		return e.NotFoundError("feed item not found", err)
	}

	if body.ReadState != nil {
		readState := strings.TrimSpace(*body.ReadState)
		if !feeds.IsValidReadState(readState) {
			return e.BadRequestError("invalid feed item read state", nil)
		}
		record.Set("read_state", readState)
	}
	if body.IsStarred != nil {
		record.Set("is_starred", *body.IsStarred)
	}
	if err := e.App.Save(record); err != nil {
		return e.InternalServerError("failed to update feed item preferences", err)
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":         record.Id,
		"read_state": record.GetString("read_state"),
		"is_starred": record.GetBool("is_starred"),
		"updated":    record.GetDateTime("updated").String(),
	})
}

// handleFeedsPoll triggers an immediate active-source polling sweep.
//
// @Summary Trigger manual feeds poll
// @Description Triggers an immediate polling sweep for active feed sources, bypassing due-time checks. Superuser only.
// @Tags Feeds
// @Security BearerAuth
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/feeds/poll [post]
func handleFeedsPoll(e *core.RequestEvent) error {
	summary, err := pollFeedsNow(nil, e.App, nil, time.Now().UTC(), true)
	if err != nil {
		return e.InternalServerError("failed to poll feeds", err)
	}

	return e.JSON(http.StatusOK, map[string]any{"summary": summary})
}

// handleFeedSourcePoll triggers an immediate poll for one active feed source.
//
// @Summary Trigger manual source poll
// @Description Triggers an immediate polling run for one active feed source, bypassing due-time checks. Superuser only.
// @Tags Feeds
// @Security BearerAuth
// @Param id path string true "feed source id"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/feeds/sources/{id}/poll [post]
func handleFeedSourcePoll(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if strings.TrimSpace(id) == "" {
		return e.BadRequestError("feed source id is required", nil)
	}

	record, err := e.App.FindRecordById(feeds.CollectionSources, id)
	if err != nil {
		return e.NotFoundError("feed source not found", err)
	}
	if strings.TrimSpace(record.GetString("status")) != feeds.StatusActive {
		return e.BadRequestError("feed source must be active to pull now", nil)
	}

	summary, err := pollFeedSourceNow(nil, e.App, nil, time.Now().UTC(), record, true)
	if err != nil {
		return e.InternalServerError("failed to poll feed source", err)
	}

	return e.JSON(http.StatusOK, map[string]any{"summary": summary})
}