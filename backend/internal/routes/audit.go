package routes

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// registerAuditRoutes registers audit log query routes.
//
// Endpoints:
//
//	GET /api/ext/audit — list audit logs with pagination and filters
func registerAuditRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	audit := g.Group("/audit")
	audit.Bind(apis.RequireSuperuserAuth())
	// @swagger group="Audit" summary="List audit logs with pagination and filters" auth=superuser
	audit.GET("", handleAuditList)
}

// handleAuditList returns paginated audit log entries.
//
// @Summary List audit logs
// @Description Returns paginated audit log entries with optional filters. Superuser only.
// @Tags Audit
// @Security BearerAuth
// @Param page query int false "Page index (default 1, max 100000)"
// @Param perPage query int false "Items per page (default 20, max 200)"
// @Param sort query string false "Sort field; prefix with - for descending. Allowed: created, updated, action, status, user_email, resource_type, resource_name"
// @Param status query string false "Filter by status"
// @Param action query string false "Filter by action"
// @Param resource_type query string false "Filter by resource type"
// @Param resource_id query string false "Filter by resource ID"
// @Param user_id query string false "Filter by user ID"
// @Param from query string false "Filter created >= from (RFC3339)"
// @Param to query string false "Filter created <= to (RFC3339)"
// @Param q query string false "Full-text search across action, resource_name, user_email, ip"
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ext/audit [get]
func handleAuditList(e *core.RequestEvent) error {
	query := e.Request.URL.Query()

	page := queryInt(query.Get("page"), 1, 1, 100000)
	perPage := queryInt(query.Get("perPage"), 20, 1, 200)
	offset := (page - 1) * perPage

	sortExpr := normalizeAuditSort(query.Get("sort"))
	filterExpr, params := buildAuditFilter(query)

	records, err := e.App.FindRecordsByFilter("audit_logs", filterExpr, sortExpr, perPage, offset, params)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"code":    500,
			"message": "failed to query audit logs",
			"data":    map[string]any{"error": err.Error()},
		})
	}

	items := make([]map[string]any, 0, len(records))
	for _, r := range records {
		items = append(items, recordToMap(r))
	}

	return e.JSON(http.StatusOK, map[string]any{
		"items": items,
		"page": map[string]any{
			"index":   page,
			"size":    perPage,
			"returned": len(items),
		},
		"filters": map[string]any{
			"status":        strings.TrimSpace(query.Get("status")),
			"action":        strings.TrimSpace(query.Get("action")),
			"resource_type": strings.TrimSpace(query.Get("resource_type")),
			"resource_id":   strings.TrimSpace(query.Get("resource_id")),
			"user_id":       strings.TrimSpace(query.Get("user_id")),
			"q":             strings.TrimSpace(query.Get("q")),
			"from":          strings.TrimSpace(query.Get("from")),
			"to":            strings.TrimSpace(query.Get("to")),
			"sort":          sortExpr,
		},
	})
}

func buildAuditFilter(query map[string][]string) (string, dbx.Params) {
	parts := []string{"id != ''"}
	params := dbx.Params{}

	if status := strings.TrimSpace(firstQuery(query, "status")); status != "" {
		parts = append(parts, "status = {:status}")
		params["status"] = status
	}
	if action := strings.TrimSpace(firstQuery(query, "action")); action != "" {
		parts = append(parts, "action = {:action}")
		params["action"] = action
	}
	if resourceType := strings.TrimSpace(firstQuery(query, "resource_type")); resourceType != "" {
		parts = append(parts, "resource_type = {:resource_type}")
		params["resource_type"] = resourceType
	}
	if resourceID := strings.TrimSpace(firstQuery(query, "resource_id")); resourceID != "" {
		parts = append(parts, "resource_id = {:resource_id}")
		params["resource_id"] = resourceID
	}
	if userID := strings.TrimSpace(firstQuery(query, "user_id")); userID != "" {
		parts = append(parts, "user_id = {:user_id}")
		params["user_id"] = userID
	}
	if from := strings.TrimSpace(firstQuery(query, "from")); from != "" {
		parts = append(parts, "created >= {:from}")
		params["from"] = from
	}
	if to := strings.TrimSpace(firstQuery(query, "to")); to != "" {
		parts = append(parts, "created <= {:to}")
		params["to"] = to
	}
	if q := strings.TrimSpace(firstQuery(query, "q")); q != "" {
		parts = append(parts, "(action ~ {:q} || resource_name ~ {:q} || user_email ~ {:q} || ip ~ {:q})")
		params["q"] = q
	}

	return strings.Join(parts, " && "), params
}

func normalizeAuditSort(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "-created"
	}

	field := s
	prefix := ""
	if strings.HasPrefix(field, "-") {
		prefix = "-"
		field = strings.TrimPrefix(field, "-")
	}

	allowed := map[string]bool{
		"created":       true,
		"updated":       true,
		"action":        true,
		"status":        true,
		"user_email":    true,
		"resource_type": true,
		"resource_name": true,
	}
	if !allowed[field] {
		return "-created"
	}
	return prefix + field
}

func queryInt(raw string, fallback, min, max int) int {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func firstQuery(query map[string][]string, key string) string {
	vals := query[key]
	if len(vals) == 0 {
		return ""
	}
	return vals[0]
}
