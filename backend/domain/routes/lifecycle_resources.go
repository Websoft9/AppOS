package routes

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

func registerReleaseRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	r := g.Group("/releases")
	r.Bind(apis.RequireSuperuserAuth())
	r.GET("", handleReleaseList)
	r.GET("/{id}", handleReleaseDetail)
}

func registerExposureRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	x := g.Group("/exposures")
	x.Bind(apis.RequireSuperuserAuth())
	x.GET("", handleExposureList)
	x.GET("/{id}", handleExposureDetail)
}

func handleReleaseList(e *core.RequestEvent) error {
	col, err := e.App.FindCollectionByNameOrId("app_releases")
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "app_releases collection not found"})
	}
	records, err := e.App.FindRecordsByFilter(col, "", "-updated", 100, 0)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to list releases"})
	}
	result := make([]map[string]any, 0, len(records))
	for _, record := range records {
		result = append(result, releaseResponse(record))
	}
	return e.JSON(http.StatusOK, result)
}

func handleReleaseDetail(e *core.RequestEvent) error {
	record, err := e.App.FindRecordById("app_releases", e.Request.PathValue("id"))
	if err != nil {
		return e.JSON(http.StatusNotFound, map[string]any{"code": 404, "message": "release not found"})
	}
	return e.JSON(http.StatusOK, releaseResponse(record))
}

func handleAppReleaseList(e *core.RequestEvent) error {
	appRecord, err := findAppInstance(e, e.Request.PathValue("id"))
	if err != nil {
		return err
	}
	col, err := e.App.FindCollectionByNameOrId("app_releases")
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "app_releases collection not found"})
	}
	filter := fmt.Sprintf("app = '%s'", escapePBFilterValue(appRecord.Id))
	records, err := e.App.FindRecordsByFilter(col, filter, "-updated", 100, 0)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to list app releases"})
	}
	result := make([]map[string]any, 0, len(records))
	for _, record := range records {
		result = append(result, releaseResponse(record))
	}
	return e.JSON(http.StatusOK, result)
}

func handleAppCurrentReleaseDetail(e *core.RequestEvent) error {
	appRecord, err := findAppInstance(e, e.Request.PathValue("id"))
	if err != nil {
		return err
	}
	releaseID := strings.TrimSpace(appRecord.GetString("current_release"))
	if releaseID == "" {
		return e.JSON(http.StatusNotFound, map[string]any{"code": 404, "message": "current release not found"})
	}
	record, err := e.App.FindRecordById("app_releases", releaseID)
	if err != nil {
		return e.JSON(http.StatusNotFound, map[string]any{"code": 404, "message": "current release not found"})
	}
	return e.JSON(http.StatusOK, releaseResponse(record))
}

func handleExposureList(e *core.RequestEvent) error {
	col, err := e.App.FindCollectionByNameOrId("app_exposures")
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "app_exposures collection not found"})
	}
	records, err := e.App.FindRecordsByFilter(col, "", "-updated", 100, 0)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to list exposures"})
	}
	result := make([]map[string]any, 0, len(records))
	for _, record := range records {
		result = append(result, exposureResponse(record))
	}
	return e.JSON(http.StatusOK, result)
}

func handleExposureDetail(e *core.RequestEvent) error {
	record, err := e.App.FindRecordById("app_exposures", e.Request.PathValue("id"))
	if err != nil {
		return e.JSON(http.StatusNotFound, map[string]any{"code": 404, "message": "exposure not found"})
	}
	return e.JSON(http.StatusOK, exposureResponse(record))
}

func handleAppExposureList(e *core.RequestEvent) error {
	appRecord, err := findAppInstance(e, e.Request.PathValue("id"))
	if err != nil {
		return err
	}
	col, err := e.App.FindCollectionByNameOrId("app_exposures")
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "app_exposures collection not found"})
	}
	filter := fmt.Sprintf("app = '%s'", escapePBFilterValue(appRecord.Id))
	records, err := e.App.FindRecordsByFilter(col, filter, "-updated", 100, 0)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to list app exposures"})
	}
	result := make([]map[string]any, 0, len(records))
	for _, record := range records {
		result = append(result, exposureResponse(record))
	}
	return e.JSON(http.StatusOK, result)
}

func handleAppExposureDetail(e *core.RequestEvent) error {
	appRecord, err := findAppInstance(e, e.Request.PathValue("id"))
	if err != nil {
		return err
	}
	record, err := e.App.FindRecordById("app_exposures", e.Request.PathValue("exposureId"))
	if err != nil || record.GetString("app") != appRecord.Id {
		return e.JSON(http.StatusNotFound, map[string]any{"code": 404, "message": "exposure not found"})
	}
	return e.JSON(http.StatusOK, exposureResponse(record))
}

func releaseResponse(record *core.Record) map[string]any {
	result := map[string]any{
		"id":                   record.Id,
		"app_id":               record.GetString("app"),
		"created_by_operation": record.GetString("created_by_operation"),
		"release_role":         record.GetString("release_role"),
		"version_label":        record.GetString("version_label"),
		"source_type":          record.GetString("source_type"),
		"source_ref":           record.GetString("source_ref"),
		"config_digest":        record.GetString("config_digest"),
		"artifact_digest":      record.GetString("artifact_digest"),
		"is_active":            record.GetBool("is_active"),
		"is_last_known_good":   record.GetBool("is_last_known_good"),
		"notes":                record.GetString("notes"),
		"created":              record.GetDateTime("created").String(),
		"updated":              record.GetDateTime("updated").String(),
	}
	if value := record.GetDateTime("activated_at"); !value.IsZero() {
		result["activated_at"] = value.String()
	}
	if value := record.GetDateTime("superseded_at"); !value.IsZero() {
		result["superseded_at"] = value.String()
	}
	return result
}

func exposureResponse(record *core.Record) map[string]any {
	result := map[string]any{
		"id":                record.Id,
		"app_id":            record.GetString("app"),
		"release_id":        record.GetString("release"),
		"exposure_type":     record.GetString("exposure_type"),
		"is_primary":        record.GetBool("is_primary"),
		"domain":            record.GetString("domain"),
		"path":              record.GetString("path"),
		"target_port":       record.GetInt("target_port"),
		"certificate_id":    record.GetString("certificate"),
		"publication_state": record.GetString("publication_state"),
		"health_state":      record.GetString("health_state"),
		"notes":             record.GetString("notes"),
		"created":           record.GetDateTime("created").String(),
		"updated":           record.GetDateTime("updated").String(),
	}
	if value := record.GetDateTime("last_verified_at"); !value.IsZero() {
		result["last_verified_at"] = value.String()
	}
	if value := record.GetDateTime("disabled_at"); !value.IsZero() {
		result["disabled_at"] = value.String()
	}
	return result
}
