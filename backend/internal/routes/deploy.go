package routes

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/internal/audit"
	"github.com/websoft9/appos/backend/internal/deploy"
)

const maxGitComposeBytes = 1 << 20

func registerDeployRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	d := g.Group("/deployments")
	d.Bind(apis.RequireSuperuserAuth())
	d.GET("", handleDeploymentList)
	d.GET("/{id}", handleDeploymentDetail)
	d.DELETE("/{id}", handleDeploymentDelete)
	d.GET("/{id}/logs", handleDeploymentLogs)
	d.GET("/{id}/stream", handleDeploymentLogStream)
	d.POST("/git-compose", handleDeploymentGitCompose)
	d.POST("/manual-compose", handleDeploymentManualCompose)
}

func handleDeploymentList(e *core.RequestEvent) error {
	col, err := e.App.FindCollectionByNameOrId("app_operations")
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "app_operations collection not found"})
	}

	records, err := e.App.FindRecordsByFilter(col, "", "-created", 100, 0)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to list operations"})
	}

	result := make([]map[string]any, 0, len(records))
	for _, record := range records {
		response, responseErr := operationRecordResponse(e.App, record)
		if responseErr != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to build operation response"})
		}
		result = append(result, response)
	}

	return e.JSON(http.StatusOK, result)
}

func handleDeploymentDetail(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if id == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "id is required"})
	}

	record, err := e.App.FindRecordById("app_operations", id)
	if err != nil {
		return e.JSON(http.StatusNotFound, map[string]any{"code": 404, "message": "operation not found"})
	}

	response, err := operationRecordResponse(e.App, record)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to build operation response"})
	}

	return e.JSON(http.StatusOK, response)
}

func handleDeploymentDelete(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if id == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "id is required"})
	}

	record, err := e.App.FindRecordById("app_operations", id)
	if err != nil {
		return e.JSON(http.StatusNotFound, map[string]any{"code": 404, "message": "operation not found"})
	}

	status := operationDisplayStatus(record)
	if isOperationActive(record) {
		return e.JSON(http.StatusConflict, map[string]any{"code": 409, "message": "active operations cannot be deleted"})
	}

	if err := e.App.RunInTransaction(func(txApp core.App) error {
		operationRecord, findErr := txApp.FindRecordById("app_operations", id)
		if findErr != nil {
			return findErr
		}
		appID := operationRecord.GetString("app")
		if deleteErr := txApp.Delete(operationRecord); deleteErr != nil {
			return deleteErr
		}
		if appID == "" {
			return nil
		}
		appRecord, findAppErr := txApp.FindRecordById("app_instances", appID)
		if findAppErr != nil {
			return nil
		}
		if appRecord.GetString("last_operation") == id && appRecord.GetString("current_release") == "" {
			lifecycleState := appRecord.GetString("lifecycle_state")
			if lifecycleState == "registered" || lifecycleState == "installing" {
				return txApp.Delete(appRecord)
			}
		}
		return nil
	}); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to delete operation"})
	}

	userID, userEmail, ip, ua := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		UserEmail:    userEmail,
		Action:       "deploy.delete",
		ResourceType: "app_operation",
		ResourceID:   id,
		ResourceName: record.GetString("compose_project_name"),
		Status:       audit.StatusSuccess,
		IP:           ip,
		UserAgent:    ua,
		Detail: map[string]any{
			"status": status,
		},
	})

	return e.JSON(http.StatusOK, map[string]any{"id": id, "deleted": true})
}

func handleDeploymentLogs(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if id == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "id is required"})
	}

	record, err := e.App.FindRecordById("app_operations", id)
	if err != nil {
		return e.JSON(http.StatusNotFound, map[string]any{"code": 404, "message": "operation not found"})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":                      record.Id,
		"status":                  operationDisplayStatus(record),
		"execution_log":           "",
		"execution_log_truncated": false,
		"updated":                 record.GetDateTime("updated").String(),
	})
}

func handleDeploymentLogStream(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if id == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "id is required"})
	}

	record, err := e.App.FindRecordById("app_operations", id)
	if err != nil {
		return e.JSON(http.StatusNotFound, map[string]any{"code": 404, "message": "operation not found"})
	}

	conn, err := wsUpgrader.Upgrade(e.Response, e.Request, nil)
	if err != nil {
		return nil
	}
	defer conn.Close()

	lastStatus := ""
	lastUpdated := ""

	sendState := func(current *core.Record) error {
		payload := map[string]any{
			"id":                      current.Id,
			"status":                  operationDisplayStatus(current),
			"updated":                 current.GetDateTime("updated").String(),
			"execution_log_truncated": false,
			"type":                    "snapshot",
			"content":                 "",
		}
		lastStatus = payload["status"].(string)
		lastUpdated = payload["updated"].(string)
		return conn.WriteJSON(payload)
	}

	if err := sendState(record); err != nil {
		return nil
	}

	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()

	for range ticker.C {
		current, findErr := e.App.FindRecordById("app_operations", id)
		if findErr != nil {
			_ = conn.WriteJSON(map[string]any{"type": "error", "message": "operation not found"})
			return nil
		}
		currentStatus := operationDisplayStatus(current)
		currentUpdated := current.GetDateTime("updated").String()
		if currentStatus == lastStatus && currentUpdated == lastUpdated {
			continue
		}
		if err := sendState(current); err != nil {
			return nil
		}
	}

	return nil
}

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
	ExistingAppID      string
	OperationType      string
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

	normalizedProjectName := deploy.NormalizeProjectName(projectName)
	if normalizedProjectName == "" {
		normalizedProjectName = "app"
	}
	composeProjectName := normalizedProjectName
	if value := strings.TrimSpace(options.ComposeProjectName); value != "" {
		composeProjectName = value
	}
	projectDir := filepath.Join("/appos/data/apps/operations", normalizedProjectName)
	if value := strings.TrimSpace(options.ProjectDir); value != "" {
		projectDir = value
	}
	operationType := strings.TrimSpace(options.OperationType)
	if operationType == "" {
		operationType = "install"
	}
	pipelineFamily := "ProvisionPipeline"
	if strings.TrimSpace(options.ExistingAppID) != "" {
		pipelineFamily = "ChangePipeline"
	}

	spec := map[string]any{
		"server_id":            serverID,
		"source":               source,
		"adapter":              adapter,
		"compose_project_name": composeProjectName,
		"project_dir":          projectDir,
		"rendered_compose":     compose,
		"operation_type":       operationType,
	}

	var operationRecord *core.Record
	err := e.App.RunInTransaction(func(txApp core.App) error {
		appInstancesCol, err := txApp.FindCollectionByNameOrId("app_instances")
		if err != nil {
			return err
		}
		operationsCol, err := txApp.FindCollectionByNameOrId("app_operations")
		if err != nil {
			return err
		}
		pipelineRunsCol, err := txApp.FindCollectionByNameOrId("pipeline_runs")
		if err != nil {
			return err
		}
		nodeRunsCol, err := txApp.FindCollectionByNameOrId("pipeline_node_runs")
		if err != nil {
			return err
		}

		var appRecord *core.Record
		if existingAppID := strings.TrimSpace(options.ExistingAppID); existingAppID != "" {
			appRecord, err = txApp.FindRecordById("app_instances", existingAppID)
			if err != nil {
				return err
			}
		} else {
			appRecord = core.NewRecord(appInstancesCol)
			appRecord.Set("key", fmt.Sprintf("%s-%d", normalizedProjectName, time.Now().UnixNano()))
			appRecord.Set("name", composeProjectName)
			appRecord.Set("server_id", serverID)
			appRecord.Set("lifecycle_state", "installing")
			appRecord.Set("desired_state", "running")
			appRecord.Set("health_summary", "unknown")
			appRecord.Set("publication_summary", "unpublished")
			appRecord.Set("state_reason", "operation queued")
			if err := txApp.Save(appRecord); err != nil {
				return err
			}
		}

		operationRecord = core.NewRecord(operationsCol)
		operationRecord.Set("app", appRecord.Id)
		operationRecord.Set("server_id", serverID)
		operationRecord.Set("operation_type", operationType)
		operationRecord.Set("trigger_source", source)
		operationRecord.Set("adapter", adapter)
		if e.Auth != nil && e.Auth.Collection() != nil && e.Auth.Collection().Name == "users" {
			operationRecord.Set("requested_by", e.Auth.Id)
		}
		operationRecord.Set("phase", "queued")
		operationRecord.Set("spec_json", spec)
		operationRecord.Set("compose_project_name", composeProjectName)
		operationRecord.Set("project_dir", projectDir)
		operationRecord.Set("rendered_compose", compose)
		operationRecord.Set("queued_at", time.Now())
		if err := txApp.Save(operationRecord); err != nil {
			return err
		}

		pipelineRun := core.NewRecord(pipelineRunsCol)
		pipelineRun.Set("operation", operationRecord.Id)
		pipelineRun.Set("pipeline_family", pipelineFamily)
		pipelineRun.Set("current_phase", "validating")
		pipelineRun.Set("status", "active")
		pipelineRun.Set("node_count", 4)
		pipelineRun.Set("completed_node_count", 0)
		if err := txApp.Save(pipelineRun); err != nil {
			return err
		}

		for _, node := range []struct {
			key   string
			label string
			phase string
		}{
			{key: "validating", label: "Validating", phase: "validating"},
			{key: "upload", label: "Upload", phase: "preparing"},
			{key: "compose_up", label: "Compose Up", phase: "executing"},
			{key: "health_check", label: "Health Check", phase: "verifying"},
		} {
			nodeRun := core.NewRecord(nodeRunsCol)
			nodeRun.Set("pipeline_run", pipelineRun.Id)
			nodeRun.Set("node_key", node.key)
			nodeRun.Set("node_type", "compose_step")
			nodeRun.Set("display_name", node.label)
			nodeRun.Set("phase", node.phase)
			nodeRun.Set("status", "pending")
			nodeRun.Set("retry_count", 0)
			if err := txApp.Save(nodeRun); err != nil {
				return err
			}
		}

		appRecord.Set("last_operation", operationRecord.Id)
		if strings.TrimSpace(options.ExistingAppID) != "" {
			appRecord.Set("lifecycle_state", "updating")
		} else {
			appRecord.Set("lifecycle_state", "installing")
		}
		appRecord.Set("state_reason", "operation queued")
		if err := txApp.Save(appRecord); err != nil {
			return err
		}

		operationRecord.Set("pipeline_run", pipelineRun.Id)
		return txApp.Save(operationRecord)
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create operation: %w", err)
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
		ResourceType: "app_operation",
		ResourceID:   operationRecord.Id,
		ResourceName: composeProjectName,
		Status:       audit.StatusPending,
		IP:           ip,
		UserAgent:    ua,
		Detail:       detail,
	})

	result, err := operationRecordResponse(e.App, operationRecord)
	if err != nil {
		return nil, err
	}
	result["enqueued"] = false
	return result, nil
}

func isOperationActive(record *core.Record) bool {
	return strings.TrimSpace(record.GetString("terminal_status")) == ""
}

func operationDisplayStatus(record *core.Record) string {
	terminalStatus := strings.TrimSpace(record.GetString("terminal_status"))
	failureReason := strings.TrimSpace(record.GetString("failure_reason"))
	if terminalStatus != "" {
		switch terminalStatus {
		case "success":
			return deploy.StatusSuccess
		case "failed":
			if failureReason == "timeout" {
				return deploy.StatusTimeout
			}
			return deploy.StatusFailed
		case "cancelled":
			return deploy.StatusCancelled
		case "compensated":
			return deploy.StatusRolledBack
		case "manual_intervention_required":
			return deploy.StatusManualInterventionRequired
		}
	}

	switch strings.TrimSpace(record.GetString("phase")) {
	case "queued":
		return deploy.StatusQueued
	case "validating":
		return deploy.StatusValidating
	case "preparing":
		return deploy.StatusPreparing
	case "executing":
		return deploy.StatusRunning
	case "verifying":
		return deploy.StatusVerifying
	case "compensating":
		return deploy.StatusRollingBack
	default:
		return deploy.StatusQueued
	}
}

func operationRecordResponse(app core.App, record *core.Record) (map[string]any, error) {
	pipelineRunID := record.GetString("pipeline_run")
	stepRuns, err := findPipelineNodeRuns(app, pipelineRunID)
	if err != nil {
		return nil, err
	}
	result := map[string]any{
		"id":                   record.Id,
		"app_id":               record.GetString("app"),
		"server_id":            record.GetString("server_id"),
		"source":               record.GetString("trigger_source"),
		"status":               operationDisplayStatus(record),
		"adapter":              record.GetString("adapter"),
		"compose_project_name": record.GetString("compose_project_name"),
		"project_dir":          record.GetString("project_dir"),
		"rendered_compose":     record.GetString("rendered_compose"),
		"error_summary":        record.GetString("error_message"),
		"has_execution_log":    false,
		"created":              record.GetDateTime("created").String(),
		"updated":              record.GetDateTime("updated").String(),
		"spec":                 record.Get("spec_json"),
		"lifecycle":            buildOperationLifecycle(record),
		"steps":                buildOperationSteps(stepRuns),
	}
	if value := record.GetDateTime("started_at"); !value.IsZero() {
		result["started_at"] = value.String()
	}
	if value := record.GetDateTime("ended_at"); !value.IsZero() {
		result["finished_at"] = value.String()
	}
	return result, nil
}

func buildOperationLifecycle(record *core.Record) []map[string]any {
	status := operationDisplayStatus(record)
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

	complete := func(keys ...string) {
		for _, key := range keys {
			if item := byKey[key]; item != nil {
				item["status"] = "completed"
			}
		}
	}
	activate := func(key string) {
		if item := byKey[key]; item != nil {
			item["status"] = "active"
		}
	}
	terminal := func(key string) {
		if item := byKey[key]; item != nil {
			item["status"] = "terminal"
		}
	}

	switch status {
	case deploy.StatusQueued:
		activate(deploy.StatusQueued)
	case deploy.StatusValidating:
		complete(deploy.StatusQueued)
		activate(deploy.StatusValidating)
	case deploy.StatusPreparing:
		complete(deploy.StatusQueued, deploy.StatusValidating)
		activate(deploy.StatusPreparing)
	case deploy.StatusRunning:
		complete(deploy.StatusQueued, deploy.StatusValidating, deploy.StatusPreparing)
		activate(deploy.StatusRunning)
	case deploy.StatusVerifying:
		complete(deploy.StatusQueued, deploy.StatusValidating, deploy.StatusPreparing, deploy.StatusRunning)
		activate(deploy.StatusVerifying)
	case deploy.StatusSuccess:
		complete(deploy.StatusQueued, deploy.StatusValidating, deploy.StatusPreparing, deploy.StatusRunning, deploy.StatusVerifying, deploy.StatusSuccess)
	case deploy.StatusFailed:
		terminal(deploy.StatusFailed)
	case deploy.StatusRollingBack:
		complete(deploy.StatusFailed)
		activate(deploy.StatusRollingBack)
	case deploy.StatusRolledBack:
		complete(deploy.StatusFailed, deploy.StatusRollingBack, deploy.StatusRolledBack)
	case deploy.StatusCancelled:
		terminal(deploy.StatusCancelled)
	case deploy.StatusTimeout:
		terminal(deploy.StatusTimeout)
	case deploy.StatusManualInterventionRequired:
		terminal(deploy.StatusManualInterventionRequired)
	default:
		activate(deploy.StatusQueued)
	}

	if summary := record.GetString("error_message"); summary != "" {
		for _, key := range []string{deploy.StatusFailed, deploy.StatusTimeout, deploy.StatusCancelled, deploy.StatusManualInterventionRequired} {
			if item := byKey[key]; item != nil && item["status"] == "terminal" {
				item["detail"] = summary
			}
		}
	}

	return lifecycle
}

func findPipelineNodeRuns(app core.App, pipelineRunID string) ([]*core.Record, error) {
	if strings.TrimSpace(pipelineRunID) == "" {
		return nil, nil
	}
	col, err := app.FindCollectionByNameOrId("pipeline_node_runs")
	if err != nil {
		return nil, err
	}
	return app.FindRecordsByFilter(col, fmt.Sprintf("pipeline_run = '%s'", escapePBFilterValue(pipelineRunID)), "created", 50, 0)
}

func buildOperationSteps(nodeRuns []*core.Record) []map[string]any {
	if len(nodeRuns) == 0 {
		return []map[string]any{
			{"key": "validating", "label": "Validating", "status": "pending"},
			{"key": "upload", "label": "Upload", "status": "pending"},
			{"key": "compose_up", "label": "Compose Up", "status": "pending"},
			{"key": "health_check", "label": "Health Check", "status": "pending"},
		}
	}

	steps := make([]map[string]any, 0, len(nodeRuns))
	for _, nodeRun := range nodeRuns {
		step := map[string]any{
			"key":    nodeRun.GetString("node_key"),
			"label":  nodeRun.GetString("display_name"),
			"status": mapNodeStatus(nodeRun.GetString("status")),
		}
		if message := nodeRun.GetString("error_message"); message != "" {
			step["detail"] = message
		}
		if value := nodeRun.GetDateTime("started_at"); !value.IsZero() {
			step["started_at"] = value.String()
		}
		if value := nodeRun.GetDateTime("ended_at"); !value.IsZero() {
			step["finished_at"] = value.String()
		}
		steps = append(steps, step)
	}
	return steps
}

func mapNodeStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "running":
		return "running"
	case "succeeded", "compensated":
		return "success"
	case "failed", "cancelled":
		return "failed"
	default:
		return "pending"
	}
}

func escapePBFilterValue(value string) string {
	return strings.ReplaceAll(value, "'", "\\'")
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
