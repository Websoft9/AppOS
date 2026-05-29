package routes

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/assets"
	"github.com/websoft9/appos/backend/infra/safefetch"
)

const scriptPullMaxBytes int64 = 1024 * 1024
const skillPullMaxArchiveBytes int64 = 10 * 1024 * 1024
const skillPullMaxFileBytes int64 = 512 * 1024
const skillPullMaxFiles = 200

var fetchRemoteScriptContent = pullRemoteTextContent
var fetchGitHubSkillContent = pullGitHubSkillContent

type assetWriteRequest struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Kind        string            `json:"kind"`
	StorageKind string            `json:"storage_kind"`
	SourceKind  string            `json:"source_kind"`
	Language    string            `json:"language"`
	Reference   string            `json:"reference"`
	Path        string            `json:"path"`
	Entrypoint  string            `json:"entrypoint"`
	Content     string            `json:"content"`
	Files       map[string]string `json:"files"`
}

func registerAssetsRoutes(se *core.ServeEvent) {
	read := se.Router.Group("/api/assets")
	read.Bind(apis.RequireAuth())

	write := se.Router.Group("/api/assets")
	write.Bind(apis.RequireAuth())
	write.Bind(apis.RequireSuperuserAuth())

	read.GET("", handleAssetList)
	read.GET("/{id}", handleAssetGet)
	read.GET("/{id}/content", handleAssetContent)

	write.POST("", handleAssetCreate)
	write.POST("/script/pull", handleAssetScriptPull)
	write.POST("/skill/pull", handleAssetSkillPull)
	write.PUT("/{id}", handleAssetUpdate)
	write.DELETE("/{id}", handleAssetDelete)
}

// handleAssetList returns all phase-1 assets for authenticated users.
//
// @Summary List assets
// @Description Returns all phase-1 asset records, including script and skill metadata. Authenticated users only.
// @Tags Assets
// @Security BearerAuth
// @Success 200 {array} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/assets [get]
func handleAssetList(e *core.RequestEvent) error {
	records, err := e.App.FindAllRecords(assets.Collection)
	if err != nil {
		return e.InternalServerError("failed to list assets", err)
	}
	result := make([]map[string]any, 0, len(records))
	for _, r := range records {
		result = append(result, assetRecordToMap(r))
	}
	return e.JSON(http.StatusOK, result)
}

// handleAssetGet returns one asset record by id.
//
// @Summary Get asset
// @Description Returns one phase-1 asset record by id. Authenticated users only.
// @Tags Assets
// @Security BearerAuth
// @Param id path string true "asset id"
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/assets/{id} [get]
func handleAssetGet(e *core.RequestEvent) error {
	record, err := e.App.FindRecordById(assets.Collection, e.Request.PathValue("id"))
	if err != nil {
		return e.NotFoundError("Asset not found", err)
	}
	return e.JSON(http.StatusOK, assetRecordToMap(record))
}

// handleAssetContent returns local content preview for one asset.
//
// @Summary Get asset content
// @Description Returns file content or folder file entries for one local asset. Reference assets do not resolve content in phase 1.
// @Tags Assets
// @Security BearerAuth
// @Param id path string true "asset id"
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 409 {object} map[string]any
// @Router /api/assets/{id}/content [get]
func handleAssetContent(e *core.RequestEvent) error {
	record, err := e.App.FindRecordById(assets.Collection, e.Request.PathValue("id"))
	if err != nil {
		return e.NotFoundError("Asset not found", err)
	}
	asset := assets.From(record)
	if asset.IsReference() {
		return e.JSON(http.StatusConflict, map[string]any{"message": "reference asset content is not resolved in phase 1"})
	}

	basePath := asset.StoragePath()
	if asset.IsSingleFile() {
		content, err := assets.ReadLocalFile(basePath, asset.Path())
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return e.NotFoundError("Asset content not found", err)
			}
			return e.BadRequestError("failed to read asset content", err)
		}
		return e.JSON(http.StatusOK, map[string]any{
			"id":           asset.ID(),
			"storage_kind": asset.StorageKind(),
			"path":         asset.Path(),
			"entrypoint":   asset.Entrypoint(),
			"content":      content,
		})
	}

	files, err := assets.ReadLocalFolder(basePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return e.NotFoundError("Asset content not found", err)
		}
		return e.BadRequestError("failed to read asset content", err)
	}
	return e.JSON(http.StatusOK, map[string]any{
		"id":           asset.ID(),
		"storage_kind": asset.StorageKind(),
		"path":         asset.Path(),
		"entrypoint":   asset.Entrypoint(),
		"files":        files,
	})
}

// handleAssetCreate creates one phase-1 asset record and persists local content when provided.
//
// @Summary Create asset
// @Description Creates one script or skill asset. Writes are limited to superusers.
// @Tags Assets
// @Security BearerAuth
// @Param body body assetWriteRequest true "asset payload"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/assets [post]
func handleAssetCreate(e *core.RequestEvent) error {
	var req assetWriteRequest
	if err := e.BindBody(&req); err != nil {
		return e.BadRequestError("Invalid request body", err)
	}
	if err := normalizeAssetWriteRequest(&req); err != nil {
		return e.BadRequestError(err.Error(), nil)
	}
	col, err := e.App.FindCollectionByNameOrId(assets.Collection)
	if err != nil {
		return e.InternalServerError("assets collection not found", err)
	}
	record := core.NewRecord(col)
	bindAssetRecord(record, req)
	if err := e.App.Save(record); err != nil {
		return e.BadRequestError("Validation failed", err)
	}
	if err := applyDerivedScriptFields(e.App, record, &req); err != nil {
		_ = e.App.Delete(record)
		return e.BadRequestError("Validation failed", err)
	}
	asset := assets.From(record)
	if err := persistAssetContent(asset, req); err != nil {
		_ = e.App.Delete(record)
		return e.BadRequestError("Failed to persist asset content", err)
	}
	return e.JSON(http.StatusOK, assetRecordToMap(record))
}

// handleAssetUpdate updates one phase-1 asset and rewrites local content when provided.
//
// @Summary Update asset
// @Description Updates one script or skill asset by id. Writes are limited to superusers.
// @Tags Assets
// @Security BearerAuth
// @Param id path string true "asset id"
// @Param body body assetWriteRequest true "asset payload"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/assets/{id} [put]
func handleAssetUpdate(e *core.RequestEvent) error {
	record, err := e.App.FindRecordById(assets.Collection, e.Request.PathValue("id"))
	if err != nil {
		return e.NotFoundError("Asset not found", err)
	}
	var req assetWriteRequest
	if err := e.BindBody(&req); err != nil {
		return e.BadRequestError("Invalid request body", err)
	}
	if err := normalizeAssetWriteRequest(&req); err != nil {
		return e.BadRequestError(err.Error(), nil)
	}
	if record.GetString("kind") == assets.KindScript {
		req.Path = assets.ScriptFileName(req.Name, record.Id, req.Language)
		req.Entrypoint = ""
	}
	bindAssetRecord(record, req)
	if err := e.App.Save(record); err != nil {
		return e.BadRequestError("Validation failed", err)
	}
	if err := persistAssetContent(assets.From(record), req); err != nil {
		return e.BadRequestError("Failed to persist asset content", err)
	}
	return e.JSON(http.StatusOK, assetRecordToMap(record))
}

// handleAssetScriptPull fetches remote script text for the create/edit form.
//
// @Summary Pull script reference content
// @Description Fetches remote script text from a validated http/https URL without persisting it. Writes are limited to superusers.
// @Tags Assets
// @Security BearerAuth
// @Param body body object true "reference URL payload"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/assets/script/pull [post]
func handleAssetScriptPull(e *core.RequestEvent) error {
	var body struct {
		Reference string `json:"reference"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid request body", err)
	}
	body.Reference = strings.TrimSpace(body.Reference)
	if body.Reference == "" {
		return e.BadRequestError("reference is required", nil)
	}
	content, err := fetchRemoteScriptContent(e.Request.Context(), body.Reference)
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}

	return e.JSON(http.StatusOK, map[string]any{"content": content})
}

// handleAssetSkillPull fetches a GitHub repository snapshot for skill editing without persisting it.
//
// @Summary Pull skill reference content
// @Description Fetches a GitHub repository snapshot, extracts text files, and returns them for the create/edit form. Writes are limited to superusers.
// @Tags Assets
// @Security BearerAuth
// @Param body body object true "GitHub reference URL payload"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/assets/skill/pull [post]
func handleAssetSkillPull(e *core.RequestEvent) error {
	var body struct {
		Reference string `json:"reference"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid request body", err)
	}
	body.Reference = strings.TrimSpace(body.Reference)
	if body.Reference == "" {
		return e.BadRequestError("reference is required", nil)
	}

	result, err := fetchGitHubSkillContent(e.Request.Context(), body.Reference)
	if err != nil {
		return e.BadRequestError(err.Error(), nil)
	}

	paths := make([]string, 0, len(result.Files))
	for filePath := range result.Files {
		paths = append(paths, filePath)
	}
	sort.Strings(paths)
	files := make([]map[string]any, 0, len(paths))
	for _, filePath := range paths {
		files = append(files, map[string]any{"path": filePath, "content": result.Files[filePath]})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"entrypoint": result.Entrypoint,
		"files":      files,
	})
}

// handleAssetDelete removes one phase-1 asset and any local storage owned by it.
//
// @Summary Delete asset
// @Description Deletes one phase-1 asset by id. Writes are limited to superusers.
// @Tags Assets
// @Security BearerAuth
// @Param id path string true "asset id"
// @Success 204 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/assets/{id} [delete]
func handleAssetDelete(e *core.RequestEvent) error {
	record, err := e.App.FindRecordById(assets.Collection, e.Request.PathValue("id"))
	if err != nil {
		return e.NotFoundError("Asset not found", err)
	}
	asset := assets.From(record)
	if asset.IsLocal() {
		if err := assets.RemoveLocalStorage(asset.StoragePath()); err != nil {
			return e.InternalServerError("Failed to remove asset storage", err)
		}
	}
	if err := e.App.Delete(record); err != nil {
		return e.InternalServerError("Failed to delete asset", err)
	}
	return e.NoContent(http.StatusNoContent)
}

func assetRecordToMap(r *core.Record) map[string]any {
	return map[string]any{
		"id":           r.Id,
		"name":         r.GetString("name"),
		"description":  r.GetString("description"),
		"kind":         r.GetString("kind"),
		"storage_kind": r.GetString("storage_kind"),
		"source_kind":  r.GetString("source_kind"),
		"language":     r.GetString("language"),
		"reference":    r.GetString("reference"),
		"path":         r.GetString("path"),
		"entrypoint":   r.GetString("entrypoint"),
		"created":      r.GetString("created"),
		"updated":      r.GetString("updated"),
	}
}

func bindAssetRecord(record *core.Record, req assetWriteRequest) {
	record.Set("name", req.Name)
	record.Set("description", req.Description)
	record.Set("kind", req.Kind)
	record.Set("storage_kind", req.StorageKind)
	record.Set("source_kind", req.SourceKind)
	record.Set("language", req.Language)
	record.Set("reference", req.Reference)
	record.Set("path", req.Path)
	record.Set("entrypoint", req.Entrypoint)
}

func normalizeAssetWriteRequest(req *assetWriteRequest) error {
	req.Name = strings.TrimSpace(req.Name)
	req.Description = strings.TrimSpace(req.Description)
	req.Kind = strings.TrimSpace(req.Kind)
	req.StorageKind = strings.TrimSpace(req.StorageKind)
	req.SourceKind = strings.TrimSpace(req.SourceKind)
	req.Language = strings.TrimSpace(strings.ToLower(req.Language))
	req.Reference = strings.TrimSpace(req.Reference)
	req.Path = strings.TrimSpace(req.Path)
	req.Entrypoint = strings.TrimSpace(req.Entrypoint)
	req.Content = strings.TrimSpace(req.Content)

	if req.Name == "" {
		return errors.New("name is required")
	}
	if !containsString(assets.SupportedKinds, req.Kind) {
		return errors.New("unsupported kind")
	}
	if !containsString(assets.SupportedStorageKinds, req.StorageKind) {
		return errors.New("unsupported storage_kind")
	}

	if req.Kind == assets.KindScript {
		if req.StorageKind != assets.StorageFile {
			return errors.New("script assets must use storage_kind=file")
		}
		if !containsString(assets.SupportedLanguages, req.Language) {
			return errors.New("unsupported language")
		}
		if req.Content == "" && req.Reference == "" {
			return errors.New("script requires content or reference")
		}
		req.Path = ""
		req.Entrypoint = ""
		if req.Content != "" {
			req.SourceKind = assets.SourceLocal
		} else {
			req.SourceKind = assets.SourceReference
		}
		return nil
	}

	if req.Kind == assets.KindSkill {
		if req.StorageKind != assets.StorageFolder {
			return errors.New("skill assets must use storage_kind=folder")
		}
		if req.Reference != "" {
			if err := validateGitHubReference(req.Reference); err != nil {
				return err
			}
		}
		if req.Entrypoint == "" {
			return errors.New("entrypoint is required for skill assets")
		}
		if len(req.Files) == 0 && req.Reference == "" {
			return errors.New("skill requires files or reference")
		}
		if len(req.Files) > 0 {
			req.SourceKind = assets.SourceLocal
		} else {
			req.SourceKind = assets.SourceReference
		}
		return nil
	}

	if !containsString(assets.SupportedSourceKinds, req.SourceKind) {
		return errors.New("unsupported source_kind")
	}
	if req.SourceKind == assets.SourceReference {
		if req.Content != "" || len(req.Files) > 0 {
			return errors.New("reference assets do not accept local content in phase 1")
		}
		return nil
	}
	if req.Entrypoint == "" {
		return errors.New("entrypoint is required for local assets")
	}
	if req.StorageKind == assets.StorageFile {
		if req.Path == "" {
			req.Path = req.Entrypoint
		}
		if req.Path == "" {
			return errors.New("path is required for file assets")
		}
		return nil
	}
	if len(req.Files) == 0 {
		return errors.New("files are required for folder assets")
	}
	return nil
}

func persistAssetContent(asset *assets.Asset, req assetWriteRequest) error {
	if asset.Kind() == assets.KindScript {
		if req.Content == "" {
			return assets.RemoveLocalStorage(asset.StoragePath())
		}
		return assets.WriteLocalFile(asset.StoragePath(), req.Path, req.Content)
	}
	if asset.Kind() == assets.KindSkill {
		if len(req.Files) == 0 {
			return assets.RemoveLocalStorage(asset.StoragePath())
		}
		return assets.WriteLocalFolder(asset.StoragePath(), req.Files)
	}
	if asset.IsReference() {
		return nil
	}
	if asset.IsSingleFile() {
		return assets.WriteLocalFile(asset.StoragePath(), req.Path, req.Content)
	}
	return assets.WriteLocalFolder(asset.StoragePath(), req.Files)
}

func containsString(items []string, value string) bool {
	for _, item := range items {
		if item == value {
			return true
		}
	}
	return false
}

type skillPullResult struct {
	Entrypoint string
	Files      map[string]string
}

func pullRemoteTextContent(ctx context.Context, reference string) (string, error) {
	if _, err := safefetch.ValidateURL(reference); err != nil {
		return "", err
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reference, nil)
	if err != nil {
		return "", fmt.Errorf("failed to build request: %w", err)
	}
	resp, err := safefetch.NewClient().Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to fetch reference: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return "", fmt.Errorf("remote server returned HTTP %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, scriptPullMaxBytes+1))
	if err != nil {
		return "", fmt.Errorf("failed to read remote content: %w", err)
	}
	if int64(len(data)) > scriptPullMaxBytes {
		return "", errors.New("remote content exceeds 1 MB limit")
	}
	if !utf8.Valid(data) {
		return "", errors.New("remote content must be valid UTF-8 text")
	}

	return string(data), nil
}

func pullGitHubSkillContent(ctx context.Context, reference string) (skillPullResult, error) {
	archiveURL, subdir, err := parseGitHubArchiveURL(reference)
	if err != nil {
		return skillPullResult{}, err
	}

	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, archiveURL, nil)
	if err != nil {
		return skillPullResult{}, fmt.Errorf("failed to build request: %w", err)
	}
	resp, err := safefetch.NewClient().Do(req)
	if err != nil {
		return skillPullResult{}, fmt.Errorf("failed to fetch GitHub repository: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return skillPullResult{}, fmt.Errorf("GitHub returned HTTP %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, skillPullMaxArchiveBytes+1))
	if err != nil {
		return skillPullResult{}, fmt.Errorf("failed to read GitHub archive: %w", err)
	}
	if int64(len(data)) > skillPullMaxArchiveBytes {
		return skillPullResult{}, errors.New("GitHub archive exceeds 10 MB limit")
	}

	files, err := extractGitHubSkillFiles(data, subdir)
	if err != nil {
		return skillPullResult{}, err
	}
	entrypoint := detectSkillEntrypoint(files)
	if entrypoint == "" {
		return skillPullResult{}, errors.New("GitHub repository did not contain any usable text files")
	}

	return skillPullResult{Entrypoint: entrypoint, Files: files}, nil
}

func validateGitHubReference(reference string) error {
	parsed, err := safefetch.ValidateURL(reference)
	if err != nil {
		return err
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "github.com" && host != "www.github.com" {
		return errors.New("skill reference must be a GitHub URL")
	}
	segments := splitGitHubPath(parsed.Path)
	if len(segments) < 2 {
		return errors.New("GitHub reference must include owner and repository")
	}
	return nil
}

func parseGitHubArchiveURL(reference string) (string, string, error) {
	parsed, err := safefetch.ValidateURL(reference)
	if err != nil {
		return "", "", err
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "github.com" && host != "www.github.com" {
		return "", "", errors.New("skill reference must be a GitHub URL")
	}
	segments := splitGitHubPath(parsed.Path)
	if len(segments) < 2 {
		return "", "", errors.New("GitHub reference must include owner and repository")
	}

	owner := segments[0]
	repo := strings.TrimSuffix(segments[1], ".git")
	if owner == "" || repo == "" {
		return "", "", errors.New("GitHub reference must include owner and repository")
	}

	archiveRef := "HEAD"
	subdir := ""
	if len(segments) > 2 {
		if len(segments) < 4 || segments[2] != "tree" {
			return "", "", errors.New("skill reference must point to a GitHub repository or tree URL")
		}
		archiveRef = segments[3]
		if archiveRef == "" {
			return "", "", errors.New("GitHub tree URL must include a branch or ref")
		}
		if len(segments) > 4 {
			subdir = path.Clean(strings.Join(segments[4:], "/"))
			if subdir == "." {
				subdir = ""
			}
			if subdir == ".." || strings.HasPrefix(subdir, "../") {
				return "", "", errors.New("GitHub tree subdirectory is invalid")
			}
		}
	}

	archiveURL := fmt.Sprintf("https://github.com/%s/%s/archive/%s.zip", url.PathEscape(owner), url.PathEscape(repo), url.PathEscape(archiveRef))
	return archiveURL, subdir, nil
}

func extractGitHubSkillFiles(data []byte, subdir string) (map[string]string, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("failed to open GitHub archive: %w", err)
	}

	normalizedSubdir := ""
	if subdir != "" {
		normalizedSubdir = path.Clean(strings.TrimPrefix(subdir, "/"))
		if normalizedSubdir == "." {
			normalizedSubdir = ""
		}
	}

	files := make(map[string]string)
	for _, file := range reader.File {
		if file.FileInfo().IsDir() {
			continue
		}
		archivePath := path.Clean(strings.TrimPrefix(file.Name, "/"))
		archivePath = strings.TrimPrefix(archivePath, "./")
		parts := strings.Split(archivePath, "/")
		if len(parts) < 2 {
			continue
		}
		relPath := path.Clean(strings.Join(parts[1:], "/"))
		if relPath == "." || relPath == "" || relPath == ".." || strings.HasPrefix(relPath, "../") {
			continue
		}
		if normalizedSubdir != "" {
			if relPath == normalizedSubdir {
				continue
			}
			if !strings.HasPrefix(relPath, normalizedSubdir+"/") {
				continue
			}
			relPath = strings.TrimPrefix(relPath, normalizedSubdir+"/")
		}
		if relPath == "" {
			continue
		}
		if len(files) >= skillPullMaxFiles {
			return nil, fmt.Errorf("GitHub repository exceeds %d files limit", skillPullMaxFiles)
		}
		if file.UncompressedSize64 > uint64(skillPullMaxFileBytes) {
			return nil, fmt.Errorf("GitHub file %s exceeds 512 KB limit", relPath)
		}
		content, err := readZipTextFile(file)
		if err != nil {
			return nil, err
		}
		if content == "" {
			continue
		}
		files[relPath] = content
	}
	if len(files) == 0 {
		return nil, errors.New("GitHub repository did not contain any usable text files")
	}
	return files, nil
}

func readZipTextFile(file *zip.File) (string, error) {
	rc, err := file.Open()
	if err != nil {
		return "", fmt.Errorf("failed to open GitHub file %s: %w", file.Name, err)
	}
	defer rc.Close()

	data, err := io.ReadAll(io.LimitReader(rc, skillPullMaxFileBytes+1))
	if err != nil {
		return "", fmt.Errorf("failed to read GitHub file %s: %w", file.Name, err)
	}
	if int64(len(data)) > skillPullMaxFileBytes {
		return "", fmt.Errorf("GitHub file %s exceeds 512 KB limit", file.Name)
	}
	if !utf8.Valid(data) {
		return "", nil
	}
	return string(data), nil
}

func detectSkillEntrypoint(files map[string]string) string {
	if _, ok := files["SKILL.md"]; ok {
		return "SKILL.md"
	}
	paths := make([]string, 0, len(files))
	for filePath := range files {
		paths = append(paths, filePath)
	}
	sort.Strings(paths)
	for _, filePath := range paths {
		if strings.EqualFold(path.Base(filePath), "SKILL.md") {
			return filePath
		}
	}
	for _, filePath := range paths {
		if strings.HasSuffix(strings.ToLower(filePath), ".md") {
			return filePath
		}
	}
	if len(paths) == 0 {
		return ""
	}
	return paths[0]
}

func splitGitHubPath(rawPath string) []string {
	trimmed := strings.Trim(path.Clean(rawPath), "/")
	if trimmed == "" || trimmed == "." {
		return nil
	}
	parts := strings.Split(trimmed, "/")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == "" || part == "." {
			continue
		}
		result = append(result, part)
	}
	return result
}

func applyDerivedScriptFields(app core.App, record *core.Record, req *assetWriteRequest) error {
	if record.GetString("kind") != assets.KindScript {
		return nil
	}
	derivedPath := assets.ScriptFileName(req.Name, record.Id, req.Language)
	if record.GetString("path") == derivedPath && record.GetString("entrypoint") == "" {
		req.Path = derivedPath
		req.Entrypoint = ""
		return nil
	}
	req.Path = derivedPath
	req.Entrypoint = ""
	record.Set("path", derivedPath)
	record.Set("entrypoint", "")
	return app.Save(record)
}
