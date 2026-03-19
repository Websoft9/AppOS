package routes

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/internal/audit"
	"github.com/websoft9/appos/backend/internal/deploy"
	"github.com/websoft9/appos/backend/internal/worker"
)

const maxGitComposeBytes = 1 << 20

func registerDeployRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	d := g.Group("/deployments")
	d.Bind(apis.RequireSuperuserAuth())
	d.GET("", handleDeploymentList)
	d.GET("/{id}", handleDeploymentDetail)
	d.GET("/{id}/logs", handleDeploymentLogs)
	d.GET("/{id}/stream", handleDeploymentLogStream)
	d.POST("/git-compose", handleDeploymentGitCompose)
	d.POST("/manual-compose", handleDeploymentManualCompose)
}

// handleDeploymentList returns deployment records for status/history surfaces.
//
// @Summary List deployments
// @Description Returns deployment records for status/history surfaces. Superuser only.
// @Tags Deploy
// @Security BearerAuth
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/deployments [get]
func handleDeploymentList(e *core.RequestEvent) error {
	col, err := e.App.FindCollectionByNameOrId("deployments")
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "deployments collection not found"})
	}

	records, err := e.App.FindRecordsByFilter(col, "", "-created", 100, 0)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to list deployments"})
	}

	result := make([]map[string]any, 0, len(records))
	for _, record := range records {
		result = append(result, deploymentRecordResponse(record))
	}

	return e.JSON(http.StatusOK, result)
}

// handleDeploymentDetail returns one deployment record with spec and lifecycle fields.
//
// @Summary Get deployment detail
// @Description Returns one deployment record with spec and lifecycle fields. Superuser only.
// @Tags Deploy
// @Security BearerAuth
// @Param id path string true "deployment ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/deployments/{id} [get]
func handleDeploymentDetail(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if id == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "id is required"})
	}

	record, err := e.App.FindRecordById("deployments", id)
	if err != nil {
		return e.JSON(http.StatusNotFound, map[string]any{"code": 404, "message": "deployment not found"})
	}

	return e.JSON(http.StatusOK, deploymentRecordResponse(record))
}

// handleDeploymentLogs returns persisted execution logs for one deployment.
//
// @Summary Get deployment logs
// @Description Returns persisted execution logs for one deployment. Superuser only.
// @Tags Deploy
// @Security BearerAuth
// @Param id path string true "deployment ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/deployments/{id}/logs [get]
func handleDeploymentLogs(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if id == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "id is required"})
	}

	record, err := e.App.FindRecordById("deployments", id)
	if err != nil {
		return e.JSON(http.StatusNotFound, map[string]any{"code": 404, "message": "deployment not found"})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":                      record.Id,
		"status":                  record.GetString("status"),
		"execution_log":           record.GetString("execution_log"),
		"execution_log_truncated": record.GetBool("execution_log_truncated"),
		"updated":                 record.GetDateTime("updated").String(),
	})
}

// handleDeploymentLogStream upgrades the request to a WebSocket and streams
// incremental execution log updates for one deployment.
//
// @Summary Stream deployment logs
// @Description Upgrades to a WebSocket and streams incremental execution log updates for one deployment. Auth via ?token= or Authorization header. Superuser only.
// @Tags Deploy
// @Security BearerAuth
// @Param id path string true "deployment ID"
// @Param token query string false "auth token (for WebSocket clients that cannot set headers)"
// @Success 101 {string} string "WebSocket upgrade"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/deployments/{id}/stream [get]
func handleDeploymentLogStream(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if id == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "id is required"})
	}

	record, err := e.App.FindRecordById("deployments", id)
	if err != nil {
		return e.JSON(http.StatusNotFound, map[string]any{"code": 404, "message": "deployment not found"})
	}

	conn, err := wsUpgrader.Upgrade(e.Response, e.Request, nil)
	if err != nil {
		log.Printf("[deploy-stream] websocket upgrade failed deploymentId=%s err=%v", id, err)
		return nil
	}
	defer conn.Close()

	lastLog := ""
	lastStatus := ""
	lastUpdated := ""

	sendState := func(current *core.Record) error {
		payload := map[string]any{
			"id":                      current.Id,
			"status":                  current.GetString("status"),
			"updated":                 current.GetDateTime("updated").String(),
			"execution_log_truncated": current.GetBool("execution_log_truncated"),
		}

		currentLog := current.GetString("execution_log")
		switch {
		case lastLog == "" || len(currentLog) < len(lastLog) || current.GetBool("execution_log_truncated"):
			payload["type"] = "snapshot"
			payload["content"] = currentLog
		case len(currentLog) > len(lastLog):
			payload["type"] = "append"
			payload["content"] = currentLog[len(lastLog):]
		default:
			payload["type"] = "status"
			payload["content"] = ""
		}

		lastLog = currentLog
		lastStatus = current.GetString("status")
		lastUpdated = current.GetDateTime("updated").String()
		return conn.WriteJSON(payload)
	}

	if err := sendState(record); err != nil {
		return nil
	}

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for range ticker.C {
		current, err := e.App.FindRecordById("deployments", id)
		if err != nil {
			_ = conn.WriteJSON(map[string]any{"type": "error", "message": "deployment not found"})
			return nil
		}

		currentLog := current.GetString("execution_log")
		currentStatus := current.GetString("status")
		currentUpdated := current.GetDateTime("updated").String()
		if currentLog == lastLog && currentStatus == lastStatus && currentUpdated == lastUpdated {
			continue
		}

		if err := sendState(current); err != nil {
			return nil
		}
	}

	return nil
}

// handleDeploymentManualCompose validates raw compose YAML, creates a deployment,
// and enqueues async execution when the worker is available.
//
// @Summary Create manual compose deployment
// @Summary Create git compose deployment
// @Description Fetches docker-compose YAML from a git-hosted raw URL or repository path, creates a deployment record, and enqueues async execution when the worker is available. Superuser only.
// @Tags Deploy
// @Security BearerAuth
// @Param body body object true "server_id, project_name, repository_url, ref, compose_path"
// @Success 202 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/deployments/git-compose [post]
func handleDeploymentGitCompose(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "invalid request body"})
	}

	req := deploy.GitComposeRequest{
		ServerID:        bodyString(body, "server_id"),
		ProjectName:     bodyString(body, "project_name"),
		RepositoryURL:   bodyString(body, "repository_url"),
		Ref:             bodyString(body, "ref"),
		ComposePath:     bodyString(body, "compose_path"),
		RawURL:          bodyString(body, "raw_url"),
		AuthHeaderName:  bodyString(body, "auth_header_name"),
		AuthHeaderValue: bodyString(body, "auth_header_value"),
	}
	if req.ServerID == "" {
		req.ServerID = "local"
	}
	if req.Ref == "" {
		req.Ref = "main"
	}
	if req.ComposePath == "" {
		req.ComposePath = "docker-compose.yml"
	}

	rawURL, err := resolveGitComposeRawURL(req)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}

	compose, err := fetchRemoteCompose(rawURL, req.AuthHeaderName, req.AuthHeaderValue)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}
	if req.ProjectName == "" {
		req.ProjectName = deriveGitProjectName(req.RepositoryURL, req.ComposePath, rawURL)
	}

	result, err := createDeploymentFromCompose(
		e,
		req.ServerID,
		req.ProjectName,
		compose,
		deploy.SourceGitOps,
		deploy.AdapterGitCompose,
		map[string]any{
			"repository_url": req.RepositoryURL,
			"ref":            req.Ref,
			"compose_path":   req.ComposePath,
			"raw_url":        rawURL,
		},
		deploymentCreateOptions{},
	)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}

	return e.JSON(http.StatusAccepted, result)
}

// handleDeploymentManualCompose validates raw compose YAML, creates a deployment,
// and enqueues async execution when the worker is available.
//
// @Summary Create manual compose deployment
// @Description Validates raw docker-compose YAML, creates a deployment record, and enqueues async execution when the worker is available. Superuser only.
// @Tags Deploy
// @Security BearerAuth
// @Param body body object true "server_id, project_name, compose"
// @Success 202 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/deployments/manual-compose [post]
func handleDeploymentManualCompose(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "invalid request body"})
	}

	req := deploy.ManualComposeRequest{
		ServerID:    bodyString(body, "server_id"),
		ProjectName: bodyString(body, "project_name"),
		Compose:     bodyString(body, "compose"),
	}
	if req.ServerID == "" {
		req.ServerID = "local"
	}
	result, err := createDeploymentFromCompose(
		e,
		req.ServerID,
		req.ProjectName,
		req.Compose,
		deploy.SourceManualOps,
		deploy.AdapterManualCompose,
		nil,
		deploymentCreateOptions{},
	)
	if err != nil {
		if strings.Contains(err.Error(), "compose") {
			return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
		}
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}

	return e.JSON(http.StatusAccepted, result)
}

type deploymentCreateOptions struct {
	ProjectDir         string
	ComposeProjectName string
}

func createDeploymentFromCompose(
	e *core.RequestEvent,
	serverID string,
	projectName string,
	compose string,
	source string,
	adapter string,
	auditDetail map[string]any,
	options deploymentCreateOptions,
) (map[string]any, error) {
	if err := deploy.ValidateManualCompose(compose); err != nil {
		return nil, err
	}

	col, err := e.App.FindCollectionByNameOrId("deployments")
	if err != nil {
		return nil, fmt.Errorf("deployments collection not found")
	}

	record := core.NewRecord(col)
	projectName = deploy.NormalizeProjectName(projectName)
	record.Set("server_id", serverID)
	record.Set("source", source)
	record.Set("adapter", adapter)
	composeProjectName := projectName
	if strings.TrimSpace(options.ComposeProjectName) != "" {
		composeProjectName = strings.TrimSpace(options.ComposeProjectName)
	}
	record.Set("compose_project_name", composeProjectName)
	record.Set("rendered_compose", compose)

	if err := deploy.ApplyEventToRecord(e.App, record, deploy.EventCreate, deploy.TransitionOptions{}); err != nil {
		return nil, fmt.Errorf("failed to create deployment")
	}

	projectDir := filepath.Join("/appos/data/apps/deployments", record.Id)
	if strings.TrimSpace(options.ProjectDir) != "" {
		projectDir = strings.TrimSpace(options.ProjectDir)
	}

	specComposeProjectName := fmt.Sprintf("%s-%s", projectName, strings.ToLower(record.Id[:8]))
	if strings.TrimSpace(options.ComposeProjectName) != "" {
		specComposeProjectName = strings.TrimSpace(options.ComposeProjectName)
	}

	spec := deploy.DeploymentSpec{
		ServerID:           serverID,
		Source:             source,
		Adapter:            adapter,
		ComposeProjectName: specComposeProjectName,
		ProjectDir:         projectDir,
		RenderedCompose:    compose,
	}
	record.Set("compose_project_name", spec.ComposeProjectName)
	record.Set("project_dir", projectDir)
	record.Set("spec", deploy.SpecToMap(spec))

	if err := e.App.Save(record); err != nil {
		return nil, fmt.Errorf("failed to finalize deployment")
	}

	userID, userEmail, ip, ua := clientInfo(e)
	detail := map[string]any{
		"source":  source,
		"adapter": adapter,
	}
	for key, value := range auditDetail {
		detail[key] = value
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		UserEmail:    userEmail,
		Action:       "deploy.create",
		ResourceType: "deployment",
		ResourceID:   record.Id,
		ResourceName: spec.ComposeProjectName,
		Status:       audit.StatusPending,
		IP:           ip,
		UserAgent:    ua,
		Detail:       detail,
	})

	enqueued := false
	if asynqClient != nil {
		payload := worker.DeployAppPayload{
			UserID:       userID,
			UserEmail:    userEmail,
			DeploymentID: record.Id,
		}
		raw, err := json.Marshal(payload)
		if err == nil {
			task := asynq.NewTask(worker.TaskDeployApp, raw)
			_, err = asynqClient.Enqueue(task)
			enqueued = err == nil
			if err != nil {
				_ = deploy.ApplyEventToRecord(e.App, record, deploy.EventQueueRejected, deploy.TransitionOptions{
					ErrorSummary: "failed to enqueue deployment task",
				})
			}
		}
	}

	result := deploymentRecordResponse(record)
	result["enqueued"] = enqueued
	return result, nil
}

func deploymentRecordResponse(record *core.Record) map[string]any {
	result := map[string]any{
		"id":                   record.Id,
		"server_id":            record.GetString("server_id"),
		"source":               record.GetString("source"),
		"status":               record.GetString("status"),
		"adapter":              record.GetString("adapter"),
		"compose_project_name": record.GetString("compose_project_name"),
		"project_dir":          record.GetString("project_dir"),
		"rendered_compose":     record.GetString("rendered_compose"),
		"error_summary":        record.GetString("error_summary"),
		"has_execution_log":    record.GetString("execution_log") != "",
		"created":              record.GetDateTime("created").String(),
		"updated":              record.GetDateTime("updated").String(),
	}

	if value := record.GetDateTime("started_at"); !value.IsZero() {
		result["started_at"] = value.String()
	}
	if value := record.GetDateTime("finished_at"); !value.IsZero() {
		result["finished_at"] = value.String()
	}
	if spec := record.Get("spec"); spec != nil {
		result["spec"] = spec
	}
	result["lifecycle"] = buildDeploymentLifecycle(record)
	result["steps"] = buildDeploymentSteps(record)
	if snapshot := record.Get("release_snapshot"); snapshot != nil {
		result["release_snapshot"] = snapshot
	}
	if record.GetString("execution_log") != "" {
		result["execution_log_truncated"] = record.GetBool("execution_log_truncated")
	}
	return result
}

func buildDeploymentLifecycle(record *core.Record) []map[string]any {
	lifecycle := []map[string]any{
		{"key": deploy.StatusQueued, "label": "Queued", "status": "pending"},
		{"key": deploy.StatusValidating, "label": "Validating", "status": "pending"},
		{"key": deploy.StatusPreparing, "label": "Preparing", "status": "pending"},
		{"key": deploy.StatusRunning, "label": "Running", "status": "pending"},
		{"key": deploy.StatusVerifying, "label": "Verifying", "status": "pending"},
		{"key": deploy.StatusSuccess, "label": "Success", "status": "pending"},
		{"key": deploy.StatusFailed, "label": "Failed", "status": "pending"},
		{"key": deploy.StatusRollingBack, "label": "Rolling Back", "status": "pending"},
		{"key": deploy.StatusRolledBack, "label": "Rolled Back", "status": "pending"},
		{"key": deploy.StatusCancelled, "label": "Cancelled", "status": "pending"},
		{"key": deploy.StatusTimeout, "label": "Timeout", "status": "pending"},
		{"key": deploy.StatusManualInterventionRequired, "label": "Manual Intervention", "status": "pending"},
	}
	byKey := map[string]map[string]any{}
	for _, item := range lifecycle {
		byKey[item["key"].(string)] = item
	}

	setStatus := func(key, status string) {
		if item := byKey[key]; item != nil {
			item["status"] = status
		}
	}

	current := record.GetString("status")
	if current == deploy.StatusQueued {
		setStatus(deploy.StatusQueued, "active")
	} else {
		setStatus(deploy.StatusQueued, "completed")
	}

	stepStatus := map[string]string{}
	for _, step := range buildDeploymentSteps(record) {
		stepStatus[fmt.Sprint(step["key"])] = fmt.Sprint(step["status"])
	}
	mapExecution := func(lifecycleKey string, executionStatus string) {
		switch executionStatus {
		case "running":
			setStatus(lifecycleKey, "active")
		case "success":
			setStatus(lifecycleKey, "completed")
		case "failed":
			setStatus(lifecycleKey, "completed")
		}
	}
	mapExecution(deploy.StatusValidating, stepStatus["validating"])
	mapExecution(deploy.StatusPreparing, stepStatus["upload"])
	mapExecution(deploy.StatusRunning, stepStatus["compose_up"])
	mapExecution(deploy.StatusVerifying, stepStatus["health_check"])

	switch current {
	case deploy.StatusValidating:
		setStatus(deploy.StatusQueued, "completed")
		setStatus(deploy.StatusValidating, "active")
	case deploy.StatusPreparing:
		setStatus(deploy.StatusQueued, "completed")
		setStatus(deploy.StatusValidating, "completed")
		setStatus(deploy.StatusPreparing, "active")
	case deploy.StatusRunning:
		setStatus(deploy.StatusQueued, "completed")
		setStatus(deploy.StatusValidating, "completed")
		setStatus(deploy.StatusPreparing, "completed")
		setStatus(deploy.StatusRunning, "active")
	case deploy.StatusVerifying:
		setStatus(deploy.StatusQueued, "completed")
		setStatus(deploy.StatusValidating, "completed")
		setStatus(deploy.StatusPreparing, "completed")
		setStatus(deploy.StatusRunning, "completed")
		setStatus(deploy.StatusVerifying, "active")
	case deploy.StatusSuccess:
		setStatus(deploy.StatusQueued, "completed")
		setStatus(deploy.StatusValidating, "completed")
		setStatus(deploy.StatusPreparing, "completed")
		setStatus(deploy.StatusRunning, "completed")
		setStatus(deploy.StatusVerifying, "completed")
		setStatus(deploy.StatusSuccess, "completed")
	case deploy.StatusFailed:
		setStatus(deploy.StatusFailed, "terminal")
	case deploy.StatusRollingBack:
		setStatus(deploy.StatusFailed, "completed")
		setStatus(deploy.StatusRollingBack, "active")
	case deploy.StatusRolledBack:
		setStatus(deploy.StatusFailed, "completed")
		setStatus(deploy.StatusRollingBack, "completed")
		setStatus(deploy.StatusRolledBack, "completed")
	case deploy.StatusCancelled:
		setStatus(deploy.StatusCancelled, "terminal")
	case deploy.StatusTimeout:
		setStatus(deploy.StatusTimeout, "terminal")
	case deploy.StatusManualInterventionRequired:
		setStatus(deploy.StatusManualInterventionRequired, "terminal")
	}

	if summary := record.GetString("error_summary"); summary != "" {
		for _, key := range []string{deploy.StatusFailed, deploy.StatusTimeout, deploy.StatusCancelled, deploy.StatusManualInterventionRequired} {
			if item := byKey[key]; item != nil && item["status"] == "terminal" {
				item["detail"] = summary
			}
		}
	}

	return lifecycle
}

func resolveGitComposeRawURL(req deploy.GitComposeRequest) (string, error) {
	if strings.TrimSpace(req.RawURL) != "" {
		parsed, err := url.Parse(req.RawURL)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return "", fmt.Errorf("raw_url is invalid")
		}
		return req.RawURL, nil
	}
	if strings.TrimSpace(req.RepositoryURL) == "" {
		return "", fmt.Errorf("repository_url is required")
	}
	parsed, err := url.Parse(req.RepositoryURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("repository_url is invalid")
	}
	composePath := strings.TrimPrefix(strings.TrimSpace(req.ComposePath), "/")
	if composePath == "" {
		return "", fmt.Errorf("compose_path is required")
	}
	pathParts := strings.Split(strings.Trim(strings.TrimSuffix(parsed.Path, ".git"), "/"), "/")
	if len(pathParts) < 2 {
		return "", fmt.Errorf("repository_url must include owner and repository")
	}
	ownerRepo := strings.Join(pathParts[:2], "/")
	ref := strings.TrimSpace(req.Ref)
	if ref == "" {
		ref = "main"
	}
	base := fmt.Sprintf("%s://%s", parsed.Scheme, parsed.Host)
	if parsed.Host == "github.com" || parsed.Host == "www.github.com" {
		return fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/%s", ownerRepo, ref, composePath), nil
	}
	if strings.Contains(parsed.Host, "gitlab") {
		return fmt.Sprintf("%s/%s/-/raw/%s/%s", base, ownerRepo, ref, composePath), nil
	}
	return fmt.Sprintf("%s/%s/raw/branch/%s/%s", base, ownerRepo, ref, composePath), nil
}

func fetchRemoteCompose(rawURL string, authHeaderName string, authHeaderValue string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to prepare compose download")
	}
	if strings.TrimSpace(authHeaderName) != "" && strings.TrimSpace(authHeaderValue) != "" {
		req.Header.Set(authHeaderName, authHeaderValue)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to download compose file")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("compose download returned %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxGitComposeBytes+1))
	if err != nil {
		return "", fmt.Errorf("failed to read compose file")
	}
	if len(body) > maxGitComposeBytes {
		return "", fmt.Errorf("compose file is too large")
	}
	return string(body), nil
}

func deriveGitProjectName(repositoryURL string, composePath string, rawURL string) string {
	value := repositoryURL
	if strings.TrimSpace(value) == "" {
		value = rawURL
	}
	parsed, err := url.Parse(value)
	if err == nil {
		segments := strings.Split(strings.Trim(strings.TrimSuffix(parsed.Path, ".git"), "/"), "/")
		if len(segments) >= 2 {
			return deploy.NormalizeProjectName(segments[1])
		}
	}
	if base := strings.TrimSuffix(filepath.Base(composePath), filepath.Ext(composePath)); base != "" {
		return deploy.NormalizeProjectName(base)
	}
	return "git-deploy"
}

func buildDeploymentSteps(record *core.Record) []map[string]any {
	steps := []map[string]any{
		{"key": "validating", "label": "Validating", "status": "pending"},
		{"key": "upload", "label": "Upload", "status": "pending"},
		{"key": "compose_up", "label": "Compose Up", "status": "pending"},
		{"key": "health_check", "label": "Health Check", "status": "pending"},
	}
	stepByKey := map[string]map[string]any{}
	for _, step := range steps {
		stepByKey[fmt.Sprint(step["key"])] = step
	}

	apply := func(key, status, ts, detail string) {
		step := stepByKey[key]
		if step == nil {
			return
		}
		step["status"] = status
		if detail != "" {
			step["detail"] = detail
		}
		if ts != "" {
			if status == "running" && step["started_at"] == nil {
				step["started_at"] = ts
			} else if status == "success" || status == "failed" {
				if step["started_at"] == nil {
					step["started_at"] = ts
				}
				step["finished_at"] = ts
			}
		}
	}

	for _, line := range strings.Split(record.GetString("execution_log"), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, " ", 2)
		ts := ""
		message := line
		if len(parts) == 2 {
			ts = parts[0]
			message = parts[1]
		}

		switch {
		case strings.Contains(message, "validation started"):
			apply("validating", "running", ts, message)
		case strings.Contains(message, "compose validation passed"):
			apply("validating", "success", ts, message)
		case strings.Contains(message, "compose validation failed") || strings.Contains(message, "failed to decode deployment spec"):
			apply("validating", "failed", ts, message)
		case strings.Contains(message, "project directory prepared") || strings.Contains(message, "preparing remote workspace"):
			apply("upload", "running", ts, message)
		case strings.Contains(message, "docker-compose.yml written"):
			apply("upload", "success", ts, message)
		case strings.Contains(message, "failed to create local project directory") || strings.Contains(message, "failed to prepare remote workspace") || strings.Contains(message, "failed to write local docker-compose.yml"):
			apply("upload", "failed", ts, message)
		case strings.Contains(message, "docker compose up started"):
			apply("compose_up", "running", ts, message)
		case strings.Contains(message, "docker compose up output"):
			apply("compose_up", "success", ts, message)
		case strings.Contains(message, "docker compose up failed"):
			apply("compose_up", "failed", ts, message)
		case strings.Contains(message, "health check started"):
			apply("health_check", "running", ts, message)
		case strings.Contains(message, "health check passed"):
			apply("health_check", "success", ts, message)
		case strings.Contains(message, "health check failed"):
			apply("health_check", "failed", ts, message)
		}
	}

	if record.GetString("status") == deploy.StatusSuccess {
		for _, step := range steps {
			if step["status"] == "pending" {
				step["status"] = "success"
			}
		}
	}
	if record.GetString("status") == deploy.StatusFailed {
		for index := len(steps) - 1; index >= 0; index -= 1 {
			if steps[index]["status"] == "running" || steps[index]["status"] == "pending" {
				steps[index]["status"] = "failed"
				if record.GetString("error_summary") != "" {
					steps[index]["detail"] = record.GetString("error_summary")
				}
				break
			}
		}
	}

	return steps
}
