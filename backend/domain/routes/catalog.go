package routes

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/domain/apptemplates"
	appcatalog "github.com/websoft9/appos/backend/domain/catalog"
)

const maxCatalogAppsLimit = 200

// registerCatalogRoutes registers canonical App Catalog read routes under /api/catalog.
func registerCatalogRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	catalog := g.Group("/catalog")

	catalog.GET("/categories", handleCatalogCategories)
	admin := catalog.Group("/admin")
	admin.Bind(apis.RequireSuperuserAuth())
	admin.GET("/status", handleCatalogAdminStatus)
	admin.POST("/reindex", handleCatalogAdminReindex)
	admin.GET("/categories/raw", handleCatalogAdminCategoriesRaw)
	admin.GET("/apps/{key}/raw", handleCatalogAdminAppRaw)

	customApps := catalog.Group("/custom-apps")
	customApps.GET("", handleCatalogCustomAppsList)
	customApps.POST("", handleCatalogCustomAppsCreate)
	customApps.PATCH("/{id}", handleCatalogCustomAppsUpdate)
	customApps.DELETE("/{id}", handleCatalogCustomAppsDelete)

	apps := catalog.Group("/apps")
	apps.GET("", handleCatalogAppsList)
	apps.GET("/{key}", handleCatalogAppDetail)
	apps.GET("/{key}/deploy-source", handleCatalogAppDeploySource)
	apps.GET("/{key}/template", handleCatalogAppTemplate)

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

func handleCatalogAppTemplate(e *core.RequestEvent) error {
	key := strings.TrimSpace(e.Request.PathValue("key"))
	if key == "" {
		return e.BadRequestError("missing app key", nil)
	}
	response, err := apptemplates.NewService().Describe(key)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			return e.NotFoundError("catalog app template not found", nil)
		}
		return apis.NewApiError(http.StatusInternalServerError, "failed to load catalog app template", err)
	}
	return e.JSON(http.StatusOK, response)
}

// @Summary Get catalog source runtime status
// @Description Returns backend-managed runtime catalog source status, seed file metadata, and current locale bundle counts. Superuser only.
// @Tags Catalog
// @Security BearerAuth
// @Success 200 {object} catalog.AdminStatusResponse
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/catalog/admin/status [get]
func handleCatalogAdminStatus(e *core.RequestEvent) error {
	response, err := appcatalog.NewService().AdminStatus()
	if err != nil {
		return apis.NewApiError(http.StatusInternalServerError, "failed to load catalog admin status", err)
	}
	return e.JSON(http.StatusOK, response)
}

// @Summary Reindex local catalog source bundles
// @Description Reloads the backend-managed runtime catalog bundles and returns current locale counts. Remote artifact sync is intentionally unavailable. Superuser only.
// @Tags Catalog
// @Security BearerAuth
// @Success 200 {object} catalog.AdminReindexResponse
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/catalog/admin/reindex [post]
func handleCatalogAdminReindex(e *core.RequestEvent) error {
	response, err := appcatalog.NewService().AdminReindex()
	if err != nil {
		return apis.NewApiError(http.StatusInternalServerError, "failed to reindex catalog source", err)
	}
	return e.JSON(http.StatusOK, response)
}

// @Summary Get raw catalog categories bundle
// @Description Returns the raw official category source bundle for one locale from the backend-managed runtime catalog directory. Superuser only.
// @Tags Catalog
// @Security BearerAuth
// @Param locale query string false "bundle locale" Enums(en, zh)
// @Success 200 {object} catalog.AdminRawCategoriesResponse
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/catalog/admin/categories/raw [get]
func handleCatalogAdminCategoriesRaw(e *core.RequestEvent) error {
	locale, err := catalogLocale(e)
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}
	response, err := appcatalog.NewService().AdminRawCategories(locale)
	if err != nil {
		return apis.NewApiError(http.StatusInternalServerError, "failed to load raw category source", err)
	}
	return e.JSON(http.StatusOK, response)
}

// @Summary Get one raw catalog app bundle entry
// @Description Returns the raw official app source payload for one app key from the backend-managed runtime catalog directory. Superuser only.
// @Tags Catalog
// @Security BearerAuth
// @Param key path string true "catalog app key"
// @Param locale query string false "bundle locale" Enums(en, zh)
// @Success 200 {object} catalog.AdminRawAppResponse
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/catalog/admin/apps/{key}/raw [get]
func handleCatalogAdminAppRaw(e *core.RequestEvent) error {
	locale, err := catalogLocale(e)
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}
	key := strings.TrimSpace(e.Request.PathValue("key"))
	if key == "" {
		return e.BadRequestError("missing app key", nil)
	}
	response, err := appcatalog.NewService().AdminRawApp(locale, key)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			return e.NotFoundError("catalog source app not found", nil)
		}
		return apis.NewApiError(http.StatusInternalServerError, "failed to load raw app source", err)
	}
	return e.JSON(http.StatusOK, response)
}

// @Summary List visible custom apps
// @Description Returns custom apps visible to the authenticated caller, including owned and shared entries.
// @Tags Catalog
// @Security BearerAuth
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/catalog/custom-apps [get]
func handleCatalogCustomAppsList(e *core.RequestEvent) error {
	response, err := appcatalog.NewService().ListCustomApps(e.App, e.Auth)
	if err != nil {
		return apis.NewApiError(http.StatusInternalServerError, "failed to load custom apps", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"items": response})
}

// @Summary Create custom app
// @Description Creates a caller-owned custom app record for the App Catalog.
// @Tags Catalog
// @Security BearerAuth
// @Param body body object true "custom app payload"
// @Success 201 {object} catalog.CustomAppRecord
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 409 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/catalog/custom-apps [post]
func handleCatalogCustomAppsCreate(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return e.BadRequestError("invalid request body", nil)
	}
	input, err := customAppUpsertFromBody(body)
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}
	response, err := appcatalog.NewService().CreateCustomApp(e.App, e.Auth, input)
	if err != nil {
		if responseErr := catalogCustomAppWriteError(err); responseErr != nil {
			return responseErr
		}
		return apis.NewApiError(http.StatusInternalServerError, "failed to create custom app", err)
	}
	return e.JSON(http.StatusCreated, response)
}

// @Summary Update custom app
// @Description Updates one caller-owned custom app record.
// @Tags Catalog
// @Security BearerAuth
// @Param id path string true "custom app id"
// @Param body body object true "custom app payload"
// @Success 200 {object} catalog.CustomAppRecord
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 409 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/catalog/custom-apps/{id} [patch]
func handleCatalogCustomAppsUpdate(e *core.RequestEvent) error {
	id := strings.TrimSpace(e.Request.PathValue("id"))
	if id == "" {
		return e.BadRequestError("missing custom app id", nil)
	}
	body, err := readBody(e)
	if err != nil {
		return e.BadRequestError("invalid request body", nil)
	}
	input, err := customAppUpsertFromBody(body)
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}
	response, err := appcatalog.NewService().UpdateCustomApp(e.App, e.Auth, id, input)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			return e.NotFoundError("custom app not found", nil)
		}
		if strings.Contains(err.Error(), "forbidden") {
			return apis.NewForbiddenError("custom app update forbidden", err)
		}
		if responseErr := catalogCustomAppWriteError(err); responseErr != nil {
			return responseErr
		}
		return apis.NewApiError(http.StatusInternalServerError, "failed to update custom app", err)
	}
	return e.JSON(http.StatusOK, response)
}

// @Summary Delete custom app
// @Description Deletes one caller-owned custom app record.
// @Tags Catalog
// @Security BearerAuth
// @Param id path string true "custom app id"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/catalog/custom-apps/{id} [delete]
func handleCatalogCustomAppsDelete(e *core.RequestEvent) error {
	id := strings.TrimSpace(e.Request.PathValue("id"))
	if id == "" {
		return e.BadRequestError("missing custom app id", nil)
	}
	err := appcatalog.NewService().DeleteCustomApp(e.App, e.Auth, id)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			return e.NotFoundError("custom app not found", nil)
		}
		if strings.Contains(err.Error(), "forbidden") {
			return apis.NewForbiddenError("custom app delete forbidden", err)
		}
		return apis.NewApiError(http.StatusInternalServerError, "failed to delete custom app", err)
	}
	return e.JSON(http.StatusOK, map[string]any{"ok": true})
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
		if parsed > maxCatalogAppsLimit {
			parsed = maxCatalogAppsLimit
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

func customAppUpsertFromBody(body map[string]any) (appcatalog.CustomAppUpsert, error) {
	categoryKeys := bodyTrimmedStringSlice(body, "category_keys")
	logoURL := optionalBodyString(body, "logo_url")
	description := optionalBodyString(body, "description")
	envText := optionalBodyString(body, "env_text")
	return appcatalog.CustomAppUpsert{
		Key:          bodyString(body, "key"),
		Trademark:    bodyString(body, "trademark"),
		LogoURL:      logoURL,
		Overview:     bodyString(body, "overview"),
		Description:  description,
		CategoryKeys: categoryKeys,
		ComposeYAML:  bodyString(body, "compose_yaml"),
		EnvText:      envText,
		Visibility:   bodyString(body, "visibility"),
	}, nil
}

func bodyTrimmedStringSlice(body map[string]any, key string) []string {
	items := bodyStringSlice(body, key)
	result := make([]string, 0, len(items))
	for _, item := range items {
		trimmed := strings.TrimSpace(item)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func optionalBodyString(body map[string]any, key string) *string {
	value, ok := body[key]
	if !ok || value == nil {
		return nil
	}
	text, ok := value.(string)
	if !ok {
		return nil
	}
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func catalogCustomAppWriteError(err error) error {
	var validationErr *appcatalog.ValidationError
	if errors.As(err, &validationErr) {
		return apis.NewBadRequestError(validationErr.Error(), err)
	}

	var conflictErr *appcatalog.ConflictError
	if errors.As(err, &conflictErr) {
		return apis.NewApiError(http.StatusConflict, conflictErr.Error(), err)
	}

	return nil
}
