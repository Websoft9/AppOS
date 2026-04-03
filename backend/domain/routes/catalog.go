package routes

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	appcatalog "github.com/websoft9/appos/backend/domain/catalog"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// registerCatalogRoutes registers canonical App Catalog read routes under /api/catalog.
func registerCatalogRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	catalog := g.Group("/catalog")

	catalog.GET("/categories", handleCatalogCategories)

	apps := catalog.Group("/apps")
	apps.GET("", handleCatalogAppsList)
	apps.GET("/{key}", handleCatalogAppDetail)
	apps.GET("/{key}/deploy-source", handleCatalogAppDeploySource)

	me := catalog.Group("/me")
	meApps := me.Group("/apps")
	meApps.GET("", handleCatalogMyApps)
	meApps.PUT("/{key}/favorite", handleCatalogFavoritePut)
	meApps.PUT("/{key}/note", handleCatalogNotePut)
	meApps.DELETE("/{key}/note", handleCatalogNoteDelete)
}

func handleCatalogCategories(e *core.RequestEvent) error {
	locale, err := catalogLocale(e)
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}
	response, err := appcatalog.NewService().Categories(e.App, e.Auth, locale)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": http.StatusInternalServerError, "message": err.Error()})
	}
	return e.JSON(http.StatusOK, response)
}

func handleCatalogAppsList(e *core.RequestEvent) error {
	query, err := catalogQuery(e)
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}
	response, err := appcatalog.NewService().Apps(e.App, e.Auth, query)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": http.StatusInternalServerError, "message": err.Error()})
	}
	return e.JSON(http.StatusOK, response)
}

func handleCatalogAppDetail(e *core.RequestEvent) error {
	locale, err := catalogLocale(e)
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}
	key := strings.TrimSpace(e.Request.PathValue("key"))
	if key == "" {
		return e.BadRequestError("missing app key", nil)
	}
	response, err := appcatalog.NewService().AppDetail(e.App, e.Auth, locale, key)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			return e.NotFoundError("catalog app not found", nil)
		}
		return apis.NewApiError(http.StatusInternalServerError, "failed to load catalog app", err)
	}
	return e.JSON(http.StatusOK, response)
}

func handleCatalogAppDeploySource(e *core.RequestEvent) error {
	locale, err := catalogLocale(e)
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}
	key := strings.TrimSpace(e.Request.PathValue("key"))
	if key == "" {
		return e.BadRequestError("missing app key", nil)
	}
	response, err := appcatalog.NewService().DeploySource(e.App, e.Auth, locale, key)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			return e.NotFoundError("catalog app not found", nil)
		}
		return apis.NewApiError(http.StatusInternalServerError, "failed to load deploy source", err)
	}
	return e.JSON(http.StatusOK, response)
}

// @Summary List caller catalog personalization
// @Description Returns the authenticated caller's catalog favorite and note state.
// @Tags Catalog
// @Security BearerAuth
// @Success 200 {object} catalog.PersonalizationListResponse
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/catalog/me/apps [get]
func handleCatalogMyApps(e *core.RequestEvent) error {
	response, err := appcatalog.NewService().Personalization(e.App, e.Auth)
	if err != nil {
		return apis.NewApiError(http.StatusInternalServerError, "failed to load personalization state", err)
	}
	return e.JSON(http.StatusOK, response)
}

// @Summary Set catalog favorite state
// @Description Idempotently sets the authenticated caller's favorite state for one catalog app.
// @Tags Catalog
// @Security BearerAuth
// @Param key path string true "catalog app key"
// @Param body body object true "favorite payload"
// @Success 200 {object} catalog.PersonalizationRecord
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/catalog/me/apps/{key}/favorite [put]
func handleCatalogFavoritePut(e *core.RequestEvent) error {
	key := strings.TrimSpace(e.Request.PathValue("key"))
	if key == "" {
		return e.BadRequestError("missing app key", nil)
	}
	body, err := readBody(e)
	if err != nil {
		return e.BadRequestError("invalid request body", nil)
	}
	response, err := appcatalog.NewService().SetFavorite(e.App, e.Auth, key, bodyBool(body, "isFavorite"))
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			return e.NotFoundError("catalog app not found", nil)
		}
		return apis.NewApiError(http.StatusInternalServerError, "failed to update favorite", err)
	}
	return e.JSON(http.StatusOK, response)
}

// @Summary Create or update catalog note
// @Description Creates or updates the authenticated caller's note for one catalog app.
// @Tags Catalog
// @Security BearerAuth
// @Param key path string true "catalog app key"
// @Param body body object true "note payload"
// @Success 200 {object} catalog.PersonalizationRecord
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/catalog/me/apps/{key}/note [put]
func handleCatalogNotePut(e *core.RequestEvent) error {
	key := strings.TrimSpace(e.Request.PathValue("key"))
	if key == "" {
		return e.BadRequestError("missing app key", nil)
	}
	body, err := readBody(e)
	if err != nil {
		return e.BadRequestError("invalid request body", nil)
	}
	note := bodyString(body, "note")
	response, err := appcatalog.NewService().SetNote(e.App, e.Auth, key, &note)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			return e.NotFoundError("catalog app not found", nil)
		}
		return apis.NewApiError(http.StatusInternalServerError, "failed to update note", err)
	}
	return e.JSON(http.StatusOK, response)
}

// @Summary Clear catalog note
// @Description Clears the authenticated caller's note for one catalog app.
// @Tags Catalog
// @Security BearerAuth
// @Param key path string true "catalog app key"
// @Success 200 {object} catalog.PersonalizationRecord
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/catalog/me/apps/{key}/note [delete]
func handleCatalogNoteDelete(e *core.RequestEvent) error {
	key := strings.TrimSpace(e.Request.PathValue("key"))
	if key == "" {
		return e.BadRequestError("missing app key", nil)
	}
	response, err := appcatalog.NewService().ClearNote(e.App, e.Auth, key)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			return e.NotFoundError("catalog app not found", nil)
		}
		return apis.NewApiError(http.StatusInternalServerError, "failed to clear note", err)
	}
	return e.JSON(http.StatusOK, response)
}

func catalogLocale(e *core.RequestEvent) (string, error) {
	locale := strings.TrimSpace(e.Request.URL.Query().Get("locale"))
	if locale == "" {
		return "en", nil
	}
	if locale != "en" && locale != "zh" {
		return "", fmt.Errorf("invalid locale; must be en or zh")
	}
	return locale, nil
}

func catalogQuery(e *core.RequestEvent) (appcatalog.Query, error) {
	locale, err := catalogLocale(e)
	if err != nil {
		return appcatalog.Query{}, err
	}
	q := e.Request.URL.Query()

	limit := 30
	if raw := strings.TrimSpace(q.Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			return appcatalog.Query{}, fmt.Errorf("invalid limit; must be a positive integer")
		}
		if parsed > 200 {
			parsed = 200
		}
		limit = parsed
	}

	offset := 0
	if raw := strings.TrimSpace(q.Get("offset")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			return appcatalog.Query{}, fmt.Errorf("invalid offset; must be a non-negative integer")
		}
		offset = parsed
	}

	source := strings.TrimSpace(q.Get("source"))
	if source == "" {
		source = "all"
	}
	if source != "all" && source != "official" && source != "custom" {
		return appcatalog.Query{}, fmt.Errorf("invalid source; must be all, official, or custom")
	}

	visibility := strings.TrimSpace(q.Get("visibility"))
	if visibility == "" {
		visibility = "all"
	}
	if visibility != "all" && visibility != "owned" && visibility != "shared" {
		return appcatalog.Query{}, fmt.Errorf("invalid visibility; must be all, owned, or shared")
	}

	var favorite *bool
	if raw := strings.TrimSpace(q.Get("favorite")); raw != "" {
		switch strings.ToLower(raw) {
		case "1", "true":
			value := true
			favorite = &value
		case "0", "false":
			value := false
			favorite = &value
		default:
			return appcatalog.Query{}, fmt.Errorf("invalid favorite; must be true, false, 1, or 0")
		}
	}

	return appcatalog.Query{
		Locale:            locale,
		PrimaryCategory:   strings.TrimSpace(q.Get("primaryCategory")),
		SecondaryCategory: strings.TrimSpace(q.Get("secondaryCategory")),
		Search:            strings.TrimSpace(q.Get("q")),
		Source:            source,
		Visibility:        visibility,
		Favorite:          favorite,
		Limit:             limit,
		Offset:            offset,
	}, nil
}