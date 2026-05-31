package routes

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/media"
)

const maxMediaSize = 2 << 20

var allowedMediaTypes = map[string]struct{}{
	"image/svg+xml":            {},
	"image/png":                {},
	"image/jpeg":               {},
	"image/webp":               {},
	"image/x-icon":             {},
	"image/vnd.microsoft.icon": {},
}

func registerMediaRoutes(se *core.ServeEvent) {
	read := se.Router.Group("/api/media")
	read.Bind(apis.RequireAuth())

	write := se.Router.Group("/api/media")
	write.Bind(apis.RequireAuth())

	publicRead := se.Router.Group("/api/media")

	read.GET("/{id}", handleMediaGet)
	read.GET("/{id}/content", handleMediaContent)
	write.POST("", handleMediaCreate)
	write.DELETE("/{id}", handleMediaDelete)
	publicRead.GET("/{id}/public", handleMediaPublic)
}

// @Summary Upload media
// @Description Upload one managed image file and return its metadata. Authenticated users only.
// @Tags Media
// @Security BearerAuth
// @Accept multipart/form-data
// @Param file formData file true "image file"
// @Param category formData string false "media category"
// @Param scope formData string false "public or private"
// @Param owner_type formData string false "owner type"
// @Param owner_id formData string false "owner id"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/media [post]
func handleMediaCreate(e *core.RequestEvent) error {
	if err := e.Request.ParseMultipartForm(maxMediaSize + (256 << 10)); err != nil {
		return e.BadRequestError("invalid multipart form", err)
	}
	file, header, err := e.Request.FormFile("file")
	if err != nil {
		return e.BadRequestError("file is required", err)
	}
	defer file.Close()

	category := firstNonEmpty(e.Request.FormValue("category"), media.CategoryGeneral)
	scope := firstNonEmpty(e.Request.FormValue("scope"), media.ScopePublic)
	ownerType := firstNonEmpty(e.Request.FormValue("owner_type"), media.OwnerTypeOther)
	ownerID := strings.TrimSpace(e.Request.FormValue("owner_id"))

	if !contains(media.SupportedCategories, category) {
		return e.BadRequestError("unsupported media category", nil)
	}
	if !contains(media.SupportedScopes, scope) {
		return e.BadRequestError("unsupported media scope", nil)
	}
	if !contains(media.SupportedOwnerTypes, ownerType) {
		return e.BadRequestError("unsupported owner type", nil)
	}
	if header.Size <= 0 || header.Size > maxMediaSize {
		return e.BadRequestError(fmt.Sprintf("file size must be between 1 byte and %d bytes", maxMediaSize), nil)
	}
	contentType := normalizeMediaType(header.Header.Get("Content-Type"), header.Filename)
	if _, ok := allowedMediaTypes[contentType]; !ok {
		return e.BadRequestError("unsupported media type", nil)
	}

	data, err := io.ReadAll(io.LimitReader(file, maxMediaSize+1))
	if err != nil {
		return e.BadRequestError("failed to read file", err)
	}
	if len(data) == 0 || len(data) > maxMediaSize {
		return e.BadRequestError(fmt.Sprintf("file size must be between 1 byte and %d bytes", maxMediaSize), nil)
	}

	col, err := e.App.FindCollectionByNameOrId(media.Collection)
	if err != nil {
		return e.InternalServerError("media collection not found", err)
	}
	record := core.NewRecord(col)
	record.Set("category", category)
	record.Set("scope", scope)
	record.Set("owner_type", ownerType)
	record.Set("owner_id", ownerID)
	record.Set("original_name", header.Filename)
	record.Set("content_type", contentType)
	record.Set("size", len(data))
	record.Set("created_by", e.Auth.Id)
	record.Set("storage_path", filepath.ToSlash(filepath.Join(scope, category, "pending.bin")))
	if err := e.App.Save(record); err != nil {
		return e.BadRequestError("validation failed", err)
	}

	storagePath := media.RelativePath(scope, category, record.Id, header.Filename)
	if _, err := media.WriteFile(storagePath, data); err != nil {
		_ = e.App.Delete(record)
		return e.BadRequestError("failed to persist media file", err)
	}
	record.Set("storage_path", storagePath)
	if scope == media.ScopePublic {
		record.Set("public_url", fmt.Sprintf("/api/media/%s/public", record.Id))
	}
	if err := e.App.Save(record); err != nil {
		_ = media.RemoveFile(storagePath)
		_ = e.App.Delete(record)
		return e.BadRequestError("validation failed", err)
	}
	return e.JSON(http.StatusOK, mediaRecordToMap(record))
}

// @Summary Get media metadata
// @Description Return one managed media record. Authenticated users only.
// @Tags Media
// @Security BearerAuth
// @Param id path string true "media id"
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/media/{id} [get]
func handleMediaGet(e *core.RequestEvent) error {
	record, err := e.App.FindRecordById(media.Collection, e.Request.PathValue("id"))
	if err != nil {
		return e.NotFoundError("media not found", err)
	}
	return e.JSON(http.StatusOK, mediaRecordToMap(record))
}

// @Summary Get media content
// @Description Stream one managed media file for authenticated users.
// @Tags Media
// @Security BearerAuth
// @Param id path string true "media id"
// @Success 200 {file} binary
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/media/{id}/content [get]
func handleMediaContent(e *core.RequestEvent) error {
	record, err := e.App.FindRecordById(media.Collection, e.Request.PathValue("id"))
	if err != nil {
		return e.NotFoundError("media not found", err)
	}
	return streamMediaRecord(e, record)
}

// @Summary Get public media content
// @Description Stream one public managed media file. Public.
// @Tags Media
// @Param id path string true "media id"
// @Success 200 {file} binary
// @Failure 404 {object} map[string]any
// @Router /api/media/{id}/public [get]
func handleMediaPublic(e *core.RequestEvent) error {
	record, err := e.App.FindRecordById(media.Collection, e.Request.PathValue("id"))
	if err != nil {
		return e.NotFoundError("media not found", err)
	}
	if record.GetString("scope") != media.ScopePublic {
		return e.NotFoundError("media not found", nil)
	}
	return streamMediaRecord(e, record)
}

// @Summary Delete media
// @Description Delete one managed media record and file. Authenticated users only.
// @Tags Media
// @Security BearerAuth
// @Param id path string true "media id"
// @Success 204 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/media/{id} [delete]
func handleMediaDelete(e *core.RequestEvent) error {
	record, err := e.App.FindRecordById(media.Collection, e.Request.PathValue("id"))
	if err != nil {
		return e.NotFoundError("media not found", err)
	}
	_ = media.RemoveFile(record.GetString("storage_path"))
	if err := e.App.Delete(record); err != nil {
		return e.InternalServerError("failed to delete media", err)
	}
	return e.NoContent(http.StatusNoContent)
}

func streamMediaRecord(e *core.RequestEvent, record *core.Record) error {
	data, err := media.ReadFile(record.GetString("storage_path"))
	if err != nil {
		if os.IsNotExist(err) {
			return e.NotFoundError("media content not found", err)
		}
		return e.BadRequestError("failed to read media file", err)
	}
	e.Response.Header().Set("Content-Type", record.GetString("content_type"))
	e.Response.Header().Set("Cache-Control", "public, max-age=300")
	_, err = e.Response.Write(data)
	return err
}

func mediaRecordToMap(r *core.Record) map[string]any {
	return map[string]any{
		"id":            r.Id,
		"category":      r.GetString("category"),
		"scope":         r.GetString("scope"),
		"owner_type":    r.GetString("owner_type"),
		"owner_id":      r.GetString("owner_id"),
		"original_name": r.GetString("original_name"),
		"content_type":  r.GetString("content_type"),
		"size":          r.GetInt("size"),
		"storage_path":  r.GetString("storage_path"),
		"public_url":    r.GetString("public_url"),
		"created_by":    r.GetString("created_by"),
		"created":       r.GetString("created"),
		"updated":       r.GetString("updated"),
	}
}

func firstNonEmpty(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func normalizeMediaType(contentType, filename string) string {
	contentType = strings.ToLower(strings.TrimSpace(contentType))
	if idx := strings.Index(contentType, ";"); idx >= 0 {
		contentType = contentType[:idx]
	}
	if contentType != "" && contentType != "application/octet-stream" {
		return contentType
	}
	switch strings.ToLower(strings.TrimPrefix(filepath.Ext(filename), ".")) {
	case "svg":
		return "image/svg+xml"
	case "png":
		return "image/png"
	case "jpg", "jpeg":
		return "image/jpeg"
	case "webp":
		return "image/webp"
	case "ico":
		return "image/x-icon"
	default:
		return ""
	}
}
