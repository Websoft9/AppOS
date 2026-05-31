package routes

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/feeds"
)

var pollFeedsNow = feeds.PollSources
var pollFeedSourceNow = feeds.PollSource
var analyzeFeedSource = feeds.AnalyzeSource
var analyzeBookmarkURL = feeds.AnalyzeBookmark
var fetchFaviconAsset = feeds.FetchFavicon

type feedItemStatePatchRequest struct {
	ReadState *string `json:"read_state"`
	IsStarred *bool   `json:"is_starred"`
}

type createBookmarkRequest struct {
	URL        string `json:"url"`
	Title      string `json:"title"`
	Summary    string `json:"summary"`
	FaviconURL string `json:"favicon_url"`
}

type analyzeBookmarkRequest struct {
	URL string `json:"url"`
}

type feedDeleteRequest struct {
	Count int `json:"count"`
}

type feedSourceUpsertRequest struct {
	Name       string `json:"name"`
	URL        string `json:"url"`
	FaviconURL string `json:"favicon_url"`
	Format     string `json:"format"`
	Status     string `json:"status"`
}

type bookmarkConflictResponse struct {
	Code     string         `json:"code"`
	Message  string         `json:"message"`
	Existing map[string]any `json:"existing"`
}

type feedSourceAnalyzeRequest struct {
	URL string `json:"url"`
}

type bookmarkListItem struct {
	ID         string `json:"id"`
	OriginType string `json:"origin_type"`
	ExternalID string `json:"external_id"`
	Title      string `json:"title"`
	Link       string `json:"link"`
	FaviconURL string `json:"favicon_url"`
	Summary    string `json:"summary"`
	ReadState  string `json:"read_state"`
	IsStarred  bool   `json:"is_starred"`
	Created    string `json:"created,omitempty"`
	Updated    string `json:"updated,omitempty"`
}

type bookmarkListResponse struct {
	Items          []bookmarkListItem `json:"items"`
	Page           int                `json:"page"`
	PerPage        int                `json:"perPage"`
	TotalItems     int                `json:"totalItems"`
	TotalBookmarks int                `json:"totalBookmarks"`
}

type feedListSourceExpand struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	URL           string `json:"url"`
	FaviconURL    string `json:"favicon_url,omitempty"`
	Format        string `json:"format"`
	Status        string `json:"status"`
	LastFetchedAt string `json:"last_fetched_at,omitempty"`
	LastSuccessAt string `json:"last_success_at,omitempty"`
	LastError     string `json:"last_error,omitempty"`
	Created       string `json:"created,omitempty"`
	Updated       string `json:"updated,omitempty"`
}

type feedListItem struct {
	ID          string `json:"id"`
	SourceID    string `json:"source_id,omitempty"`
	OriginType  string `json:"origin_type"`
	ExternalID  string `json:"external_id"`
	Title       string `json:"title"`
	Link        string `json:"link"`
	FaviconURL  string `json:"favicon_url,omitempty"`
	PublishedAt string `json:"published_at,omitempty"`
	Summary     string `json:"summary,omitempty"`
	ContentRaw  string `json:"content_raw,omitempty"`
	ReadState   string `json:"read_state"`
	IsStarred   bool   `json:"is_starred"`
	Created     string `json:"created,omitempty"`
	Updated     string `json:"updated,omitempty"`
	Expand      struct {
		SourceID *feedListSourceExpand `json:"source_id,omitempty"`
	} `json:"expand,omitempty"`
}

type feedListResponse struct {
	Items      []feedListItem `json:"items"`
	Page       int            `json:"page"`
	PerPage    int            `json:"perPage"`
	TotalItems int            `json:"totalItems"`
}

type feedSummarySourceCount struct {
	SourceID string `json:"sourceId"`
	Count    int    `json:"count"`
}

type feedSummaryResponse struct {
	TotalItems   int                      `json:"totalItems"`
	StarredItems int                      `json:"starredItems"`
	SourceCounts []feedSummarySourceCount `json:"sourceCounts"`
}

type feedSourceRecordResponse struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	URL           string `json:"url"`
	FaviconURL    string `json:"favicon_url,omitempty"`
	ItemCount     int    `json:"item_count"`
	Format        string `json:"format"`
	Status        string `json:"status"`
	LastFetchedAt string `json:"last_fetched_at,omitempty"`
	LastSuccessAt string `json:"last_success_at,omitempty"`
	LastError     string `json:"last_error,omitempty"`
	Created       string `json:"created,omitempty"`
	Updated       string `json:"updated,omitempty"`
}

type feedSourceListResponse struct {
	Items      []feedSourceRecordResponse `json:"items"`
	Page       int                        `json:"page"`
	PerPage    int                        `json:"perPage"`
	TotalItems int                        `json:"totalItems"`
}

type feedSourceConflictResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type feedListRow struct {
	ID                  string `db:"id"`
	SourceID            string `db:"source_id"`
	OriginType          string `db:"origin_type"`
	ExternalID          string `db:"external_id"`
	Title               string `db:"title"`
	Link                string `db:"link"`
	FaviconURL          string `db:"favicon_url"`
	PublishedAt         string `db:"published_at"`
	Summary             string `db:"summary"`
	ContentRaw          string `db:"content_raw"`
	ReadState           string `db:"read_state"`
	IsStarred           bool   `db:"is_starred"`
	Created             string `db:"created"`
	Updated             string `db:"updated"`
	SourceExpandID      string `db:"source_expand_id"`
	SourceExpandName    string `db:"source_expand_name"`
	SourceExpandURL     string `db:"source_expand_url"`
	SourceExpandFavicon string `db:"source_expand_favicon_url"`
	SourceExpandFormat  string `db:"source_expand_format"`
	SourceExpandStatus  string `db:"source_expand_status"`
	SourceExpandFetched string `db:"source_expand_last_fetched_at"`
	SourceExpandSuccess string `db:"source_expand_last_success_at"`
	SourceExpandError   string `db:"source_expand_last_error"`
	SourceExpandCreated string `db:"source_expand_created"`
	SourceExpandUpdated string `db:"source_expand_updated"`
}

type feedTotalRow struct {
	TotalItems int `db:"total_items"`
}

type feedSummaryTotalsRow struct {
	TotalItems   int `db:"total_items"`
	StarredItems int `db:"starred_items"`
}

type feedSummaryCountRow struct {
	SourceID string `db:"source_id"`
	Count    int    `db:"count"`
}

const (
	defaultBookmarkListPage    = 1
	defaultBookmarkListPerPage = 10
	maxBookmarkListPerPage     = 100
	defaultFeedListPage        = 1
	defaultFeedListPerPage     = 20
	maxFeedListPerPage         = 100
)

// registerFeedsRoutes registers authenticated feeds actions under /api/feeds.
func registerFeedsRoutes(se *core.ServeEvent) {
	se.Router.GET("/api/feeds/favicon", handleFeedFavicon)

	g := se.Router.Group("/api/feeds")
	g.Bind(apis.RequireAuth())
	admin := se.Router.Group("/api/feeds")
	admin.Bind(apis.RequireSuperuserAuth())

	g.GET("/bookmarks", handleListBookmarks)
	g.GET("/items", handleListFeedItems)
	g.GET("/sources", handleListFeedSources)
	g.GET("/summary", handleFeedSummary)
	g.POST("/bookmarks", handleCreateBookmark)
	g.POST("/bookmarks/analyze", handleAnalyzeBookmark)
	g.PATCH("/bookmarks/{id}", handleUpdateBookmark)
	g.DELETE("/bookmarks/{id}", handleDeleteBookmark)
	g.POST("/items/{id}/bookmark", handleFeedItemBookmark)
	g.PATCH("/items/{id}/state", handleFeedItemStatePatch)
	admin.POST("/analyze", handleFeedSourceAnalyze)
	admin.POST("/delete", handleFeedDelete)
	admin.POST("/poll", handleFeedsPoll)
	admin.POST("/sources", handleCreateFeedSource)
	admin.PATCH("/sources/{id}", handleUpdateFeedSource)
	admin.DELETE("/sources/{id}", handleDeleteFeedSource)
	admin.POST("/sources/{id}/delete", handleFeedSourceDelete)
	admin.POST("/sources/{id}/poll", handleFeedSourcePoll)
}

func marshalFeedSourceRecord(record *core.Record) feedSourceRecordResponse {
	if record == nil {
		return feedSourceRecordResponse{}
	}

	return feedSourceRecordResponse{
		ID:            record.Id,
		Name:          record.GetString("name"),
		URL:           record.GetString("url"),
		FaviconURL:    record.GetString("favicon_url"),
		ItemCount:     record.GetInt("item_count"),
		Format:        record.GetString("format"),
		Status:        record.GetString("status"),
		LastFetchedAt: record.GetDateTime("last_fetched_at").String(),
		LastSuccessAt: record.GetDateTime("last_success_at").String(),
		LastError:     record.GetString("last_error"),
		Created:       record.GetDateTime("created").String(),
		Updated:       record.GetDateTime("updated").String(),
	}
}

func toFeedSourceUpsertInput(body feedSourceUpsertRequest) feeds.SourceUpsertInput {
	return feeds.SourceUpsertInput{
		Name:       body.Name,
		URL:        body.URL,
		FaviconURL: body.FaviconURL,
		Format:     body.Format,
		Status:     body.Status,
	}
}

func handleFeedSourceServiceError(e *core.RequestEvent, err error, fallbackMessage string) error {
	var validationErr *feeds.SourceValidationError
	if errors.As(err, &validationErr) {
		return e.BadRequestError(validationErr.Message, nil)
	}

	var conflictErr *feeds.SourceConflictError
	if errors.As(err, &conflictErr) {
		return e.JSON(http.StatusConflict, feedSourceConflictResponse{
			Code:    conflictErr.Code,
			Message: conflictErr.Message,
		})
	}

	var notFoundErr *feeds.SourceNotFoundError
	if errors.As(err, &notFoundErr) {
		return e.NotFoundError("feed source not found", err)
	}

	return e.InternalServerError(fallbackMessage, err)
}

func buildFeedListWhere(sourceID, query string, starred bool) (string, dbx.Params) {
	params := dbx.Params{
		"origin_type": feeds.OriginTypeFeed,
	}
	clauses := []string{"fi.origin_type = {:origin_type}"}

	if sourceID != "" {
		clauses = append(clauses, "fi.source_id = {:source_id}")
		params["source_id"] = sourceID
	}
	if starred {
		clauses = append(clauses, "fi.is_starred = TRUE")
	}
	if query != "" {
		clauses = append(clauses, "(lower(fi.title) LIKE {:query_like} OR lower(fi.summary) LIKE {:query_like} OR lower(fi.link) LIKE {:query_like} OR lower(coalesce(fs.name, '')) LIKE {:query_like})")
		params["query_like"] = "%" + strings.ToLower(query) + "%"
	}

	return strings.Join(clauses, " AND "), params
}

func handleListFeedItems(e *core.RequestEvent) error {
	page := parsePositiveQueryInt(e.Request.URL.Query().Get("page"), defaultFeedListPage)
	perPage := parsePositiveQueryInt(e.Request.URL.Query().Get("perPage"), defaultFeedListPerPage)
	if perPage > maxFeedListPerPage {
		perPage = maxFeedListPerPage
	}

	sourceID := strings.TrimSpace(e.Request.URL.Query().Get("sourceId"))
	query := strings.TrimSpace(e.Request.URL.Query().Get("q"))
	starred := strings.EqualFold(strings.TrimSpace(e.Request.URL.Query().Get("starred")), "true")

	whereClause, params := buildFeedListWhere(sourceID, query, starred)

	// Omit the JOIN from the COUNT when there is no text-search: the WHERE clause
	// only references fi columns in that case, so the index scan is much faster.
	var total feedTotalRow
	var countQuery string
	if query == "" {
		countQuery = `SELECT COUNT(*) AS total_items FROM feed_items fi WHERE ` + whereClause
	} else {
		countQuery = `SELECT COUNT(*) AS total_items FROM feed_items fi LEFT JOIN feed_sources fs ON fs.id = fi.source_id WHERE ` + whereClause
	}
	if err := e.App.DB().NewQuery(countQuery).Bind(params).One(&total); err != nil {
		return e.InternalServerError("failed to count feed items", err)
	}

	pageCount := max(1, (total.TotalItems+perPage-1)/perPage)
	if page > pageCount {
		page = pageCount
	}
	offset := (page - 1) * perPage

	listParams := dbx.Params{}
	for key, value := range params {
		listParams[key] = value
	}
	listParams["limit"] = perPage
	listParams["offset"] = offset

	listQuery := `
		SELECT
			fi.id,
			coalesce(fi.source_id, '') AS source_id,
			fi.origin_type,
			fi.external_id,
			fi.title,
			fi.link,
			coalesce(fi.favicon_url, '') AS favicon_url,
			coalesce(fi.published_at, '') AS published_at,
			coalesce(fi.summary, '') AS summary,
			coalesce(fi.content_raw, '') AS content_raw,
			fi.read_state,
			fi.is_starred,
			coalesce(fi.created, '') AS created,
			coalesce(fi.updated, '') AS updated,
			coalesce(fs.id, '') AS source_expand_id,
			coalesce(fs.name, '') AS source_expand_name,
			coalesce(fs.url, '') AS source_expand_url,
			coalesce(fs.favicon_url, '') AS source_expand_favicon_url,
			coalesce(fs.format, '') AS source_expand_format,
			coalesce(fs.status, '') AS source_expand_status,
			coalesce(fs.last_fetched_at, '') AS source_expand_last_fetched_at,
			coalesce(fs.last_success_at, '') AS source_expand_last_success_at,
			coalesce(fs.last_error, '') AS source_expand_last_error,
			coalesce(fs.created, '') AS source_expand_created,
			coalesce(fs.updated, '') AS source_expand_updated
		FROM feed_items fi
		LEFT JOIN feed_sources fs ON fs.id = fi.source_id
		WHERE ` + whereClause + `
		ORDER BY fi.published_at DESC, fi.created DESC
		LIMIT {:limit} OFFSET {:offset}`

	rows := make([]feedListRow, 0, perPage)
	if err := e.App.DB().NewQuery(listQuery).Bind(listParams).All(&rows); err != nil {
		return e.InternalServerError("failed to list feed items", err)
	}

	items := make([]feedListItem, 0, len(rows))
	for _, row := range rows {
		item := feedListItem{
			ID:          row.ID,
			SourceID:    row.SourceID,
			OriginType:  row.OriginType,
			ExternalID:  row.ExternalID,
			Title:       row.Title,
			Link:        row.Link,
			FaviconURL:  row.FaviconURL,
			PublishedAt: row.PublishedAt,
			Summary:     row.Summary,
			ContentRaw:  row.ContentRaw,
			ReadState:   row.ReadState,
			IsStarred:   row.IsStarred,
			Created:     row.Created,
			Updated:     row.Updated,
		}
		if row.SourceExpandID != "" {
			item.Expand.SourceID = &feedListSourceExpand{
				ID:            row.SourceExpandID,
				Name:          row.SourceExpandName,
				URL:           row.SourceExpandURL,
				FaviconURL:    row.SourceExpandFavicon,
				Format:        row.SourceExpandFormat,
				Status:        row.SourceExpandStatus,
				LastFetchedAt: row.SourceExpandFetched,
				LastSuccessAt: row.SourceExpandSuccess,
				LastError:     row.SourceExpandError,
				Created:       row.SourceExpandCreated,
				Updated:       row.SourceExpandUpdated,
			}
		}
		items = append(items, item)
	}

	return e.JSON(http.StatusOK, feedListResponse{
		Items:      items,
		Page:       page,
		PerPage:    perPage,
		TotalItems: total.TotalItems,
	})
}

func handleFeedSummary(e *core.RequestEvent) error {
	var totals feedSummaryTotalsRow
	if err := e.App.DB().NewQuery(`
		SELECT
			COUNT(*) AS total_items,
			COALESCE(SUM(CASE WHEN is_starred THEN 1 ELSE 0 END), 0) AS starred_items
		FROM feed_items
		WHERE origin_type = {:origin_type}`,
	).Bind(dbx.Params{"origin_type": feeds.OriginTypeFeed}).One(&totals); err != nil {
		return e.InternalServerError("failed to summarize feed items", err)
	}

	rows := make([]feedSummaryCountRow, 0)
	if err := e.App.DB().NewQuery(`
		SELECT
			fs.id AS source_id,
			COUNT(fi.id) AS count
		FROM feed_sources fs
		LEFT JOIN feed_items fi ON fi.source_id = fs.id AND fi.origin_type = {:origin_type}
		GROUP BY fs.id`,
	).Bind(dbx.Params{"origin_type": feeds.OriginTypeFeed}).All(&rows); err != nil {
		return e.InternalServerError("failed to summarize feed source counts", err)
	}

	sourceCounts := make([]feedSummarySourceCount, 0, len(rows))
	for _, row := range rows {
		sourceCounts = append(sourceCounts, feedSummarySourceCount(row))
	}

	return e.JSON(http.StatusOK, feedSummaryResponse{
		TotalItems:   totals.TotalItems,
		StarredItems: totals.StarredItems,
		SourceCounts: sourceCounts,
	})
}

// handleListFeedSources returns feed subscriptions through the feeds bounded context.
//
// @Summary List feed sources
// @Description Returns feed source records ordered by latest update. Authenticated users only.
// @Tags Feeds
// @Security BearerAuth
// @Success 200 {object} feedSourceListResponse
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/feeds/sources [get]
func handleListFeedSources(e *core.RequestEvent) error {
	records, err := feeds.ListSources(e.App)
	if err != nil {
		return e.InternalServerError("failed to list feed sources", err)
	}

	items := make([]feedSourceRecordResponse, 0, len(records))
	for _, record := range records {
		items = append(items, marshalFeedSourceRecord(record))
	}

	return e.JSON(http.StatusOK, feedSourceListResponse{
		Items:      items,
		Page:       1,
		PerPage:    len(items),
		TotalItems: len(items),
	})
}

// handleFeedFavicon downloads a remote favicon and returns it as a same-origin image.
//
// Supports auth via Authorization header OR ?token= query param for browser image elements.
//
// @Summary Proxy favicon image
// @Description Downloads one remote favicon through the backend with SSRF protection and image-size/type limits.
// @Tags Feeds
// @Security BearerAuth
// @Param url query string true "remote favicon URL"
// @Param token query string false "auth token for browser image contexts"
// @Success 200 {string} string "favicon image"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 502 {object} map[string]any
// @Router /api/feeds/favicon [get]
func handleFeedFavicon(e *core.RequestEvent) error {
	auth := e.Auth
	if auth == nil {
		if tok := e.Request.URL.Query().Get("token"); tok != "" {
			rec, err := e.App.FindAuthRecordByToken(tok, core.TokenTypeAuth)
			if err == nil {
				auth = rec
			}
		}
	}
	if auth == nil {
		return e.UnauthorizedError("Authentication required", nil)
	}

	faviconURL := strings.TrimSpace(e.Request.URL.Query().Get("url"))
	if faviconURL == "" {
		return e.BadRequestError("favicon url is required", nil)
	}

	// Cap the external HTTP round-trip so a slow/unreachable favicon host does
	// not tie up a browser connection for longer than necessary.
	ctx, cancel := context.WithTimeout(e.Request.Context(), 2*time.Second)
	defer cancel()

	asset, err := fetchFaviconAsset(ctx, faviconURL, nil)
	if err != nil {
		return e.BadRequestError("failed to fetch favicon", err)
	}

	e.Response.Header().Set("Content-Type", asset.ContentType)
	e.Response.Header().Set("Cache-Control", "public, max-age=86400")
	e.Response.Header().Set("X-Content-Type-Options", "nosniff")
	_, err = e.Response.Write(asset.Data)
	return err
}

// handleListBookmarks returns a paginated bookmark list decoupled from feed article fetch windows.
//
// @Summary List bookmarks
// @Description Returns paginated bookmarks with independent search and totals. Authenticated users only.
// @Tags Feeds
// @Security BearerAuth
// @Param page query int false "page number"
// @Param perPage query int false "page size"
// @Param q query string false "bookmark search query"
// @Success 200 {object} bookmarkListResponse
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/feeds/bookmarks [get]
func handleListBookmarks(e *core.RequestEvent) error {
	page := parsePositiveQueryInt(e.Request.URL.Query().Get("page"), defaultBookmarkListPage)
	perPage := parsePositiveQueryInt(e.Request.URL.Query().Get("perPage"), defaultBookmarkListPerPage)
	if perPage > maxBookmarkListPerPage {
		perPage = maxBookmarkListPerPage
	}

	query := strings.TrimSpace(e.Request.URL.Query().Get("q"))
	records, err := e.App.FindRecordsByFilter(
		feeds.CollectionItems,
		"origin_type = {:origin_type}",
		"-updated,-created",
		0,
		0,
		map[string]any{"origin_type": feeds.OriginTypeBookmark},
	)
	if err != nil {
		return e.InternalServerError("failed to list bookmarks", err)
	}
	totalBookmarks := len(records)
	filteredRecords := records
	if query != "" {
		normalizedQuery := strings.ToLower(query)
		filteredRecords = make([]*core.Record, 0, len(records))
		for _, record := range records {
			haystack := strings.ToLower(strings.Join([]string{
				record.GetString("title"),
				record.GetString("summary"),
				record.GetString("link"),
			}, " "))
			if strings.Contains(haystack, normalizedQuery) {
				filteredRecords = append(filteredRecords, record)
			}
		}
	}
	totalItems := len(filteredRecords)

	pageCount := max(1, (totalItems+perPage-1)/perPage)
	if page > pageCount {
		page = pageCount
	}
	offset := (page - 1) * perPage
	end := min(offset+perPage, totalItems)
	if offset > totalItems {
		offset = totalItems
	}
	pageRecords := filteredRecords[offset:end]

	items := make([]bookmarkListItem, 0, len(pageRecords))
	for _, record := range pageRecords {
		items = append(items, bookmarkListItem{
			ID:         record.Id,
			OriginType: record.GetString("origin_type"),
			ExternalID: record.GetString("external_id"),
			Title:      record.GetString("title"),
			Link:       record.GetString("link"),
			FaviconURL: record.GetString("favicon_url"),
			Summary:    record.GetString("summary"),
			ReadState:  record.GetString("read_state"),
			IsStarred:  record.GetBool("is_starred"),
			Created:    record.GetDateTime("created").String(),
			Updated:    record.GetDateTime("updated").String(),
		})
	}

	return e.JSON(http.StatusOK, bookmarkListResponse{
		Items:          items,
		Page:           page,
		PerPage:        perPage,
		TotalItems:     totalItems,
		TotalBookmarks: totalBookmarks,
	})
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
		Link:       body.URL,
		Title:      body.Title,
		Summary:    body.Summary,
		FaviconURL: body.FaviconURL,
	})
	normalized.OriginType = feeds.OriginTypeBookmark
	normalized.IsStarred = false
	if normalized.Title == "" {
		normalized.Title = normalized.Link
	}

	existing, err := e.App.FindFirstRecordByFilter(feeds.CollectionItems, "origin_type = {:origin_type} && external_id = {:external_id}", map[string]any{
		"origin_type": feeds.OriginTypeBookmark,
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
	record.Set("favicon_url", normalized.FaviconURL)
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
		"favicon_url": record.GetString("favicon_url"),
		"read_state":  record.GetString("read_state"),
		"is_starred":  record.GetBool("is_starred"),
	})
}

// handleAnalyzeBookmark fetches one URL and extracts bookmark metadata.
//
// @Summary Analyze bookmark URL
// @Description Fetches one webpage URL and extracts title, description, and favicon metadata for the bookmark form. Authenticated users only.
// @Tags Feeds
// @Security BearerAuth
// @Param body body analyzeBookmarkRequest true "bookmark analyze payload"
// @Success 200 {object} feeds.BookmarkAnalysis
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/feeds/bookmarks/analyze [post]
func handleAnalyzeBookmark(e *core.RequestEvent) error {
	var body analyzeBookmarkRequest
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid JSON body", err)
	}

	url := strings.TrimSpace(body.URL)
	if url == "" {
		return e.BadRequestError("bookmark url is required", nil)
	}

	analysis, err := analyzeBookmarkURL(nil, url, nil)
	if err != nil {
		return e.BadRequestError("failed to analyze bookmark url", err)
	}

	return e.JSON(http.StatusOK, analysis)
}

// handleUpdateBookmark updates one bookmark record without turning it into a feed source.
//
// @Summary Update bookmark item
// @Description Updates one bookmark item in the Feeds workspace. Authenticated users only.
// @Tags Feeds
// @Security BearerAuth
// @Param id path string true "bookmark item id"
// @Param body body createBookmarkRequest true "bookmark payload"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/feeds/bookmarks/{id} [patch]
func handleUpdateBookmark(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if strings.TrimSpace(id) == "" {
		return e.BadRequestError("bookmark item id is required", nil)
	}

	var body createBookmarkRequest
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid JSON body", err)
	}

	if strings.TrimSpace(body.URL) == "" {
		return e.BadRequestError("bookmark url is required", nil)
	}

	record, err := e.App.FindRecordById(feeds.CollectionItems, id)
	if err != nil {
		return e.NotFoundError("bookmark item not found", err)
	}
	if record.GetString("origin_type") != feeds.OriginTypeBookmark {
		return e.NotFoundError("bookmark item not found", nil)
	}

	normalized := feeds.NormalizeItem(feeds.ItemCandidate{
		Link:       body.URL,
		Title:      body.Title,
		Summary:    body.Summary,
		FaviconURL: body.FaviconURL,
	})
	normalized.OriginType = feeds.OriginTypeBookmark
	if normalized.Title == "" {
		normalized.Title = normalized.Link
	}

	existing, err := e.App.FindFirstRecordByFilter(feeds.CollectionItems, "origin_type = {:origin_type} && external_id = {:external_id}", map[string]any{
		"origin_type": feeds.OriginTypeBookmark,
		"external_id": normalized.ExternalID,
	})
	if err == nil && existing.Id != record.Id {
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

	record.Set("external_id", normalized.ExternalID)
	record.Set("title", normalized.Title)
	record.Set("link", normalized.Link)
	record.Set("summary", normalized.Summary)
	record.Set("favicon_url", normalized.FaviconURL)
	if err := e.App.Save(record); err != nil {
		return e.InternalServerError("failed to update bookmark", err)
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":          record.Id,
		"origin_type": record.GetString("origin_type"),
		"title":       record.GetString("title"),
		"link":        record.GetString("link"),
		"summary":     record.GetString("summary"),
		"favicon_url": record.GetString("favicon_url"),
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

func parsePositiveQueryInt(raw string, fallback int) int {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(trimmed)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
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

// handleCreateFeedSource creates one feed source through the feeds bounded context.
//
// @Summary Create feed source
// @Description Creates one feed source record for the Feeds workspace. Superuser only.
// @Tags Feeds
// @Security BearerAuth
// @Param body body feedSourceUpsertRequest true "feed source payload"
// @Success 200 {object} feedSourceRecordResponse
// @Failure 400 {object} map[string]any
// @Failure 409 {object} feedSourceConflictResponse
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/feeds/sources [post]
func handleCreateFeedSource(e *core.RequestEvent) error {
	var body feedSourceUpsertRequest
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid JSON body", err)
	}

	record, err := feeds.CreateSource(e.App, toFeedSourceUpsertInput(body))
	if err != nil {
		return handleFeedSourceServiceError(e, err, "failed to create feed source")
	}

	return e.JSON(http.StatusOK, marshalFeedSourceRecord(record))
}

// handleUpdateFeedSource updates one feed source through the feeds bounded context.
//
// @Summary Update feed source
// @Description Updates one feed source record for the Feeds workspace. Superuser only.
// @Tags Feeds
// @Security BearerAuth
// @Param id path string true "feed source id"
// @Param body body feedSourceUpsertRequest true "feed source payload"
// @Success 200 {object} feedSourceRecordResponse
// @Failure 400 {object} map[string]any
// @Failure 409 {object} feedSourceConflictResponse
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/feeds/sources/{id} [patch]
func handleUpdateFeedSource(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if strings.TrimSpace(id) == "" {
		return e.BadRequestError("feed source id is required", nil)
	}

	var body feedSourceUpsertRequest
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid JSON body", err)
	}

	record, err := feeds.UpdateSource(e.App, id, toFeedSourceUpsertInput(body))
	if err != nil {
		return handleFeedSourceServiceError(e, err, "failed to update feed source")
	}

	return e.JSON(http.StatusOK, marshalFeedSourceRecord(record))
}

// handleDeleteFeedSource deletes one feed source through the feeds bounded context.
//
// @Summary Delete feed source
// @Description Deletes one feed source record and its cascade-linked feed items. Superuser only.
// @Tags Feeds
// @Security BearerAuth
// @Param id path string true "feed source id"
// @Success 204 {string} string ""
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/feeds/sources/{id} [delete]
func handleDeleteFeedSource(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if err := feeds.DeleteSource(e.App, id); err != nil {
		return handleFeedSourceServiceError(e, err, "failed to delete feed source")
	}

	return e.NoContent(http.StatusNoContent)
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

// handleFeedItemBookmark converts one feed item into a bookmark-shaped item.
//
// @Summary Convert feed item to bookmark
// @Description Converts one feed article into a bookmark item without pulling feeds. Authenticated users only.
// @Tags Feeds
// @Security BearerAuth
// @Param id path string true "feed item id"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 409 {object} bookmarkConflictResponse
// @Failure 500 {object} map[string]any
// @Router /api/feeds/items/{id}/bookmark [post]
func handleFeedItemBookmark(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if strings.TrimSpace(id) == "" {
		return e.BadRequestError("feed item id is required", nil)
	}

	record, err := e.App.FindRecordById(feeds.CollectionItems, id)
	if err != nil {
		return e.NotFoundError("feed item not found", err)
	}
	if record.GetString("origin_type") != feeds.OriginTypeFeed {
		return e.BadRequestError("feed item is already a bookmark", nil)
	}

	normalized := feeds.NormalizeItem(feeds.ItemCandidate{
		Link:       record.GetString("link"),
		Title:      record.GetString("title"),
		Summary:    record.GetString("summary"),
		FaviconURL: record.GetString("favicon_url"),
	})
	if normalized.Link == "" {
		return e.BadRequestError("feed item link is required", nil)
	}
	if normalized.Title == "" {
		normalized.Title = normalized.Link
	}

	existing, err := e.App.FindFirstRecordByFilter(feeds.CollectionItems, "origin_type = {:origin_type} && external_id = {:external_id}", map[string]any{
		"origin_type": feeds.OriginTypeBookmark,
		"external_id": normalized.ExternalID,
	})
	if err == nil && existing.Id != record.Id {
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

	record.Set("origin_type", feeds.OriginTypeBookmark)
	record.Set("external_id", normalized.ExternalID)
	record.Set("title", normalized.Title)
	record.Set("link", normalized.Link)
	record.Set("summary", normalized.Summary)
	record.Set("favicon_url", normalized.FaviconURL)
	previousSourceID := record.GetString("source_id")
	record.Set("source_id", nil)
	record.Set("is_starred", false)
	if err := e.App.Save(record); err != nil {
		return e.InternalServerError("failed to convert feed item to bookmark", err)
	}
	if err := feeds.RefreshSourceItemCount(e.App, previousSourceID); err != nil {
		return e.InternalServerError("failed to refresh feed source count", err)
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":          record.Id,
		"origin_type": record.GetString("origin_type"),
		"external_id": record.GetString("external_id"),
		"title":       record.GetString("title"),
		"link":        record.GetString("link"),
		"summary":     record.GetString("summary"),
		"favicon_url": record.GetString("favicon_url"),
		"read_state":  record.GetString("read_state"),
		"is_starred":  record.GetBool("is_starred"),
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

// handleFeedDelete deletes the oldest pulled feed articles globally.
//
// @Summary Delete pulled feed articles globally
// @Description Deletes the oldest pulled feed items globally by count. Bookmarks are preserved. Superuser only.
// @Tags Feeds
// @Security BearerAuth
// @Param body body feedDeleteRequest true "global delete payload"
// @Success 200 {object} feeds.GlobalDeleteResult
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/feeds/delete [post]
func handleFeedDelete(e *core.RequestEvent) error {
	var body feedDeleteRequest
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid JSON body", err)
	}
	if body.Count <= 0 {
		return e.BadRequestError("delete count must be greater than zero", nil)
	}

	result, err := feeds.DeleteGlobalItems(e.App, body.Count)
	if err != nil {
		return e.InternalServerError("failed to delete feed articles", err)
	}

	return e.JSON(http.StatusOK, result)
}

// handleFeedSourceDelete deletes the oldest pulled feed articles for one source and keeps the source config.
//
// @Summary Delete feed source articles by count
// @Description Deletes the oldest feed items for one source by count and preserves the source record. Superuser only.
// @Tags Feeds
// @Security BearerAuth
// @Param id path string true "feed source id"
// @Param body body feedDeleteRequest true "source delete payload"
// @Success 200 {object} feeds.SourceDeleteResult
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/feeds/sources/{id}/delete [post]
func handleFeedSourceDelete(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if strings.TrimSpace(id) == "" {
		return e.BadRequestError("feed source id is required", nil)
	}

	var body feedDeleteRequest
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid JSON body", err)
	}
	if body.Count <= 0 {
		return e.BadRequestError("delete count must be greater than zero", nil)
	}

	result, err := feeds.DeleteSourceArticles(e.App, id, body.Count)
	if err != nil {
		return handleFeedSourceServiceError(e, err, "failed to delete source feed articles")
	}

	return e.JSON(http.StatusOK, result)
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

	summary, err := feeds.PollSourceNow(context.TODO(), e.App, nil, time.Now().UTC(), id, pollFeedSourceNow)
	if err != nil {
		return handleFeedSourceServiceError(e, err, "failed to poll feed source")
	}

	return e.JSON(http.StatusOK, map[string]any{"summary": summary})
}
