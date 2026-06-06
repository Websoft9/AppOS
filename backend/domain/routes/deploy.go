package routes

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/domain/apptemplates"
	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingsschema "github.com/websoft9/appos/backend/domain/config/sysconfig/schema"
	"github.com/websoft9/appos/backend/domain/deploy"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
	"github.com/websoft9/appos/backend/domain/lifecycle/projection"
	lifecyclesvc "github.com/websoft9/appos/backend/domain/lifecycle/service"
	"github.com/websoft9/appos/backend/domain/worker"
	"gopkg.in/yaml.v3"
)

const maxGitComposeBytes = 1 << 20

func loadDeployGitDefaults(app core.App) (string, string) {
	group, _ := sysconfig.GetGroup(app, "deploy", "git-defaults", settingsschema.DefaultGroup("deploy", "git-defaults"))
	defaultRef := strings.TrimSpace(sysconfig.String(group, "defaultRef", "main"))
	if defaultRef == "" {
		defaultRef = "main"
	}
	defaultComposePath := strings.TrimSpace(sysconfig.String(group, "defaultComposePath", "docker-compose.yml"))
	if defaultComposePath == "" {
		defaultComposePath = "docker-compose.yml"
	}
	return defaultRef, defaultComposePath
}

func registerOperationRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	controls := g.Group("/actions")
	controls.Bind(apis.RequireAuth())
	// @swagger auth=auth summary="Cancel queued action"
	controls.POST("/{id}/cancel", handleOperationCancel)
	// @swagger auth=auth summary="Force fail running action"
	controls.POST("/{id}/force-fail", handleOperationForceFail)

	o := g.Group("/actions")
	o.Bind(apis.RequireSuperuserAuth())
	o.GET("", handleOperationList)
	o.GET("/{id}", handleOperationDetail)
	o.DELETE("/{id}", handleOperationDelete)
	o.GET("/{id}/logs", handleOperationLogs)
	o.POST("/install/name-availability", handleOperationInstallNameAvailability)
	o.POST("/install/git-compose", handleOperationInstallGitCompose)
	o.POST("/install/manual-compose", handleOperationInstallManualCompose)
	o.POST("/install/template", handleOperationInstallTemplate)
	o.POST("/install/git-compose/check", handleOperationInstallGitComposeCheck)
	o.POST("/install/manual-compose/check", handleOperationInstallManualComposeCheck)
	o.POST("/install/template/check", handleOperationInstallTemplateCheck)

	stream := g.Group("/actions")
	stream.Bind(wsTokenAuth())
	stream.Bind(apis.RequireSuperuserAuth())
	stream.GET("/{id}/stream", handleOperationLogStream)

	p := g.Group("/pipelines")
	p.Bind(apis.RequireSuperuserAuth())
	p.GET("", handlePipelineList)
	p.GET("/{id}", handlePipelineDetail)
}

func handlePipelineList(e *core.RequestEvent) error {
	col, err := e.App.FindCollectionByNameOrId("pipeline_runs")
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "pipeline_runs collection not found"})
	}

	records, err := e.App.FindRecordsByFilter(col, "", "-created", 100, 0)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to list pipelines"})
	}

	result := make([]map[string]any, 0, len(records))
	for _, record := range records {
		response, responseErr := pipelineRunRecordResponse(e.App, record)
		if responseErr != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to build pipeline response"})
		}
		result = append(result, response)
	}

	return e.JSON(http.StatusOK, result)
}

func handlePipelineDetail(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if id == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "id is required"})
	}

	record, err := e.App.FindRecordById("pipeline_runs", id)
	if err != nil {
		return e.JSON(http.StatusNotFound, map[string]any{"code": 404, "message": "pipeline not found"})
	}

	response, err := pipelineRunRecordResponse(e.App, record)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to build pipeline response"})
	}

	return e.JSON(http.StatusOK, response)
}

func handleOperationList(e *core.RequestEvent) error {
	col, err := e.App.FindCollectionByNameOrId("app_operations")
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "app_operations collection not found"})
	}

	query := e.Request.URL.Query()
	pageRaw := strings.TrimSpace(query.Get("page"))
	perPageRaw := strings.TrimSpace(query.Get("perPage"))
	if pageRaw != "" || perPageRaw != "" {
		page := parsePositiveQueryInt(pageRaw, 1)
		perPage := parsePositiveQueryInt(perPageRaw, 15)
		if perPage > 500 {
			perPage = 500
		}

		records, totalItems, err := listOperationRecords(e.App, col, operationListQueryOptions{
			AppID:         strings.TrimSpace(query.Get("appId")),
			Query:         strings.TrimSpace(query.Get("q")),
			SortField:     strings.TrimSpace(query.Get("sortField")),
			SortDir:       strings.TrimSpace(query.Get("sortDir")),
			ExcludeStatus: splitOperationListCSV(query.Get("excludeStatus")),
			ExcludeSource: splitOperationListCSV(query.Get("excludeSource")),
			ExcludeServer: splitOperationListCSV(query.Get("excludeServer")),
			Page:          page,
			PerPage:       perPage,
		})
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to list operations"})
		}

		items := make([]map[string]any, 0, len(records))
		for _, record := range records {
			response, responseErr := operationRecordResponse(e.App, record)
			if responseErr != nil {
				return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to build operation response"})
			}
			items = append(items, response)
		}

		totalPages := max(1, (totalItems+perPage-1)/perPage)
		if page > totalPages {
			page = totalPages
		}
		return e.JSON(http.StatusOK, map[string]any{
			"items":      items,
			"page":       page,
			"perPage":    perPage,
			"totalItems": totalItems,
			"totalPages": totalPages,
		})
	}

	records, err := e.App.FindRecordsByFilter(col, "", "-created", 0, 0)
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

func handleOperationDetail(e *core.RequestEvent) error {
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

func handleOperationDelete(e *core.RequestEvent) error {
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
		Action:       "operation.delete",
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

// @Summary Cancel queued action
// @Description Immediately terminalizes one queued lifecycle action as cancelled before execution starts. Authenticated users only.
// @Tags Actions
// @Security BearerAuth
// @Param id path string true "action id"
// @Success 200 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 409 {object} map[string]any
// @Router /api/actions/{id}/cancel [post]
func handleOperationCancel(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if id == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "id is required"})
	}

	var response map[string]any
	err := e.App.RunInTransaction(func(txApp core.App) error {
		record, err := txApp.FindRecordById("app_operations", id)
		if err != nil {
			return err
		}
		if strings.TrimSpace(record.GetString("terminal_status")) != "" {
			return fmt.Errorf("terminal operations cannot be cancelled")
		}
		if strings.TrimSpace(record.GetString("phase")) != string(model.OperationPhaseQueued) {
			return fmt.Errorf("only queued operations can be cancelled")
		}
		if err := cancelQueuedOperation(txApp, record, "operation cancelled before execution started"); err != nil {
			return err
		}
		response, err = operationRecordResponse(txApp, record)
		return err
	})
	if err != nil {
		if strings.Contains(err.Error(), "terminal operations cannot be cancelled") || strings.Contains(err.Error(), "only queued operations can be cancelled") {
			return e.JSON(http.StatusConflict, map[string]any{"code": 409, "message": err.Error()})
		}
		return e.JSON(http.StatusNotFound, map[string]any{"code": 404, "message": "operation not found"})
	}

	userID, userEmail, ip, ua := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		UserEmail:    userEmail,
		Action:       "operation.cancel",
		ResourceType: "app_operation",
		ResourceID:   id,
		ResourceName: fmt.Sprint(response["compose_project_name"]),
		Status:       audit.StatusSuccess,
		IP:           ip,
		UserAgent:    ua,
		Detail: map[string]any{
			"status": response["status"],
		},
	})

	return e.JSON(http.StatusOK, response)
}

// @Summary Force fail running action
// @Description Immediately terminalizes one executing lifecycle action as failed and releases its active slot without guaranteeing rollback. Authenticated users only.
// @Tags Actions
// @Security BearerAuth
// @Param id path string true "action id"
// @Success 200 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 409 {object} map[string]any
// @Router /api/actions/{id}/force-fail [post]
func handleOperationForceFail(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if id == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "id is required"})
	}

	var response map[string]any
	err := e.App.RunInTransaction(func(txApp core.App) error {
		record, err := txApp.FindRecordById("app_operations", id)
		if err != nil {
			return err
		}
		if strings.TrimSpace(record.GetString("terminal_status")) != "" {
			return fmt.Errorf("terminal operations cannot be force-failed")
		}
		if strings.TrimSpace(record.GetString("phase")) != string(model.OperationPhaseExecuting) {
			return fmt.Errorf("only executing operations can be force-failed")
		}
		if err := forceFailOperation(txApp, record, "operation force-failed by operator"); err != nil {
			return err
		}
		response, err = operationRecordResponse(txApp, record)
		return err
	})
	if err != nil {
		if strings.Contains(err.Error(), "terminal operations cannot be force-failed") || strings.Contains(err.Error(), "only executing operations can be force-failed") {
			return e.JSON(http.StatusConflict, map[string]any{"code": 409, "message": err.Error()})
		}
		return e.JSON(http.StatusNotFound, map[string]any{"code": 404, "message": "operation not found"})
	}

	userID, userEmail, ip, ua := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		UserEmail:    userEmail,
		Action:       "operation.force_fail",
		ResourceType: "app_operation",
		ResourceID:   id,
		ResourceName: fmt.Sprint(response["compose_project_name"]),
		Status:       audit.StatusSuccess,
		IP:           ip,
		UserAgent:    ua,
		Detail: map[string]any{
			"status": response["status"],
		},
	})

	return e.JSON(http.StatusOK, response)
}

func cancelQueuedOperation(app core.App, operation *core.Record, message string) error {
	now := time.Now()
	if strings.TrimSpace(message) == "" {
		message = "operation cancelled before execution started"
	}

	appRecord, pipelineRecord, nodeRuns, err := loadOperationRelations(app, operation)
	if err != nil {
		return err
	}

	for _, nodeRun := range nodeRuns {
		if status := strings.TrimSpace(nodeRun.GetString("status")); status != "pending" && status != "running" {
			continue
		}
		nodeRun.Set("status", "cancelled")
		nodeRun.Set("error_message", message)
		nodeRun.Set("ended_at", now)
		if err := app.Save(nodeRun); err != nil {
			return err
		}
	}

	if pipelineRecord != nil {
		pipelineRecord.Set("status", "cancelled")
		pipelineRecord.Set("ended_at", now)
		if err := app.Save(pipelineRecord); err != nil {
			return err
		}
	}

	operation.Set("cancel_requested_at", now)
	operation.Set("terminal_status", "cancelled")
	operation.Set("app_outcome", operationFailureOutcome(appRecord))
	operation.Set("error_message", message)
	operation.Set("ended_at", now)
	if err := app.Save(operation); err != nil {
		return err
	}

	if appRecord != nil {
		projection.ApplyOperationCancelled(appRecord, operation)
		if err := app.Save(appRecord); err != nil {
			return err
		}
	}

	return nil
}

func forceFailOperation(app core.App, operation *core.Record, message string) error {
	now := time.Now()
	if strings.TrimSpace(message) == "" {
		message = "operation force-failed by operator"
	}

	appRecord, pipelineRecord, nodeRuns, err := loadOperationRelations(app, operation)
	if err != nil {
		return err
	}

	failedNodeKey := ""
	for _, nodeRun := range nodeRuns {
		status := strings.TrimSpace(nodeRun.GetString("status"))
		switch status {
		case "running":
			nodeRun.Set("status", "failed")
			nodeRun.Set("error_message", message)
			nodeRun.Set("ended_at", now)
			if failedNodeKey == "" {
				failedNodeKey = strings.TrimSpace(nodeRun.GetString("node_key"))
			}
		case "pending":
			nodeRun.Set("status", "cancelled")
			nodeRun.Set("error_message", message)
			nodeRun.Set("ended_at", now)
		}
		if status == "running" || status == "pending" {
			if err := app.Save(nodeRun); err != nil {
				return err
			}
		}
	}

	if pipelineRecord != nil {
		pipelineRecord.Set("status", "failed")
		pipelineRecord.Set("failed_node_key", failedNodeKey)
		pipelineRecord.Set("ended_at", now)
		if err := app.Save(pipelineRecord); err != nil {
			return err
		}
	}

	operation.Set("terminal_status", "failed")
	operation.Set("failure_reason", "execution_error")
	operation.Set("app_outcome", operationFailureOutcome(appRecord))
	operation.Set("error_message", message)
	operation.Set("ended_at", now)
	if err := app.Save(operation); err != nil {
		return err
	}

	if appRecord != nil {
		projection.ApplyOperationFailed(appRecord, operation)
		if err := app.Save(appRecord); err != nil {
			return err
		}
	}

	return nil
}

func loadOperationRelations(app core.App, operation *core.Record) (*core.Record, *core.Record, []*core.Record, error) {
	var appRecord *core.Record
	appID := strings.TrimSpace(operation.GetString("app"))
	if appID != "" {
		record, err := app.FindRecordById("app_instances", appID)
		if err != nil {
			return nil, nil, nil, err
		}
		appRecord = record
	}

	var pipelineRecord *core.Record
	pipelineID := strings.TrimSpace(operation.GetString("pipeline_run"))
	if pipelineID != "" {
		record, err := app.FindRecordById("pipeline_runs", pipelineID)
		if err != nil {
			return nil, nil, nil, err
		}
		pipelineRecord = record
	}

	nodeRuns := make([]*core.Record, 0)
	if pipelineID != "" {
		col, err := app.FindCollectionByNameOrId("pipeline_node_runs")
		if err != nil {
			return nil, nil, nil, err
		}
		nodeRuns, err = app.FindRecordsByFilter(col, fmt.Sprintf("pipeline_run = '%s'", escapePBFilterValue(pipelineID)), "created", 100, 0)
		if err != nil {
			return nil, nil, nil, err
		}
	}

	return appRecord, pipelineRecord, nodeRuns, nil
}

func operationFailureOutcome(appRecord *core.Record) string {
	if appRecord == nil || strings.TrimSpace(appRecord.GetString("current_release")) == "" {
		return "no_healthy_release"
	}
	return "previous_release_active"
}

func handleOperationLogs(e *core.RequestEvent) error {
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
		"execution_log":           record.GetString("execution_log"),
		"execution_log_truncated": record.GetBool("execution_log_truncated"),
		"updated":                 record.GetDateTime("updated").String(),
	})
}

func handleOperationLogStream(e *core.RequestEvent) error {
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
	lastContent := ""
	lastTruncated := false
	const logStreamPollInterval = 250 * time.Millisecond

	sendState := func(current *core.Record, forceSnapshot bool) error {
		currentStatus := operationDisplayStatus(current)
		currentUpdated := current.GetDateTime("updated").String()
		currentContent := current.GetString("execution_log")
		currentTruncated := current.GetBool("execution_log_truncated")

		messageType := "snapshot"
		content := currentContent
		if !forceSnapshot && !currentTruncated && !lastTruncated && strings.HasPrefix(currentContent, lastContent) {
			if len(currentContent) > len(lastContent) {
				messageType = "append"
				content = currentContent[len(lastContent):]
			}
		}

		payload := map[string]any{
			"id":                      current.Id,
			"status":                  currentStatus,
			"updated":                 currentUpdated,
			"execution_log_truncated": currentTruncated,
			"type":                    messageType,
			"content":                 content,
		}
		lastStatus = currentStatus
		lastUpdated = currentUpdated
		lastContent = currentContent
		lastTruncated = currentTruncated
		return conn.WriteJSON(payload)
	}

	if err := sendState(record, true); err != nil {
		return nil
	}

	ticker := time.NewTicker(logStreamPollInterval)
	defer ticker.Stop()

	for range ticker.C {
		current, findErr := e.App.FindRecordById("app_operations", id)
		if findErr != nil {
			_ = conn.WriteJSON(map[string]any{"type": "error", "message": "operation not found"})
			return nil
		}
		currentStatus := operationDisplayStatus(current)
		currentUpdated := current.GetDateTime("updated").String()
		currentContent := current.GetString("execution_log")
		currentTruncated := current.GetBool("execution_log_truncated")
		if currentStatus == lastStatus && currentUpdated == lastUpdated && currentContent == lastContent && currentTruncated == lastTruncated {
			continue
		}
		if err := sendState(current, false); err != nil {
			return nil
		}
	}

	return nil
}

// @Summary Check install name availability
// @Description Normalizes a candidate install name and reports whether it is available for a new app instance. Superuser only.
// @Tags Actions
// @Security BearerAuth
// @Param body body object true "name availability payload"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/actions/install/name-availability [post]
func handleOperationInstallNameAvailability(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "invalid request body"})
	}

	rawName := bodyString(body, "project_name")
	result, err := lifecyclesvc.CheckInstallNameAvailability(e.App, rawName)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "required") {
			return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
		}
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}

	return e.JSON(http.StatusOK, result)
}

func handleOperationInstallGitCompose(e *core.RequestEvent) error {
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
	if err := requireManagedServerID(req.ServerID); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}
	defaultRef, defaultComposePath := loadDeployGitDefaults(e.App)
	if req.Ref == "" {
		req.Ref = defaultRef
	}
	if req.ComposePath == "" {
		req.ComposePath = defaultComposePath
	}

	rawURL, err := resolveGitComposeRawURL(req)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}

	compose, err := fetchRemoteCompose(rawURL, req.AuthHeaderName, req.AuthHeaderValue)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}
	resolutionRequest := lifecyclesvc.BuildGitComposeInstallResolutionRequest(req, compose, rawURL, buildInstallIngressOptionsFromBody(e.Auth, body, nil))

	result, err := createOperationFromCompose(
		e,
		resolutionRequest.ServerID,
		resolutionRequest.ProjectName,
		resolutionRequest.Compose,
		resolutionRequest.Source,
		resolutionRequest.Adapter,
		lifecyclesvc.GitComposeAuditDetail(req, rawURL),
		operationCreateOptions{
			OperationType:      resolutionRequest.OperationType,
			ProjectDir:         resolutionRequest.ProjectDir,
			ComposeProjectName: resolutionRequest.ComposeProjectName,
			ResolvedEnv:        resolutionRequest.Env,
			ExposureIntent:     resolutionRequest.ExposureIntent,
			Metadata:           resolutionRequest.Metadata,
			RuntimeInputs:      resolutionRequest.RuntimeInputs,
			SourceBuild:        resolutionRequest.SourceBuild,
		},
	)
	if err != nil {
		if isOperationCreateConflict(err) {
			return e.JSON(http.StatusConflict, map[string]any{"code": 409, "message": err.Error()})
		}
		if isOperationCreateBadRequest(err) {
			return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
		}
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}

	return e.JSON(http.StatusAccepted, result)
}

// @Summary Check Git Compose install preflight
// @Description Resolves and validates a Git Compose install request without creating an action. Returns compose validity, duplicate-name checks, and host-port conflict findings when available. Superuser only.
// @Tags Actions
// @Security BearerAuth
// @Param body body object true "git compose install preflight payload"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/actions/install/git-compose/check [post]
func handleOperationInstallGitComposeCheck(e *core.RequestEvent) error {
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
	if err := requireManagedServerID(req.ServerID); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}
	defaultRef, defaultComposePath := loadDeployGitDefaults(e.App)
	if req.Ref == "" {
		req.Ref = defaultRef
	}
	if req.ComposePath == "" {
		req.ComposePath = defaultComposePath
	}

	rawURL, err := resolveGitComposeRawURL(req)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}

	compose, err := fetchRemoteCompose(rawURL, req.AuthHeaderName, req.AuthHeaderValue)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}
	resolutionRequest := lifecyclesvc.BuildGitComposeInstallResolutionRequest(req, compose, rawURL, buildInstallIngressOptionsFromBody(e.Auth, body, nil))

	result, err := lifecyclesvc.CheckInstallFromCompose(
		e.App,
		lifecyclesvc.InstallPreflightRequest{InstallResolutionRequest: resolutionRequest},
		newRouteInstallPreflightProbe(e),
	)
	if err != nil {
		if isOperationCreateBadRequest(err) {
			return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
		}
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}

	return e.JSON(http.StatusOK, result)
}

func handleOperationInstallManualCompose(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "invalid request body"})
	}

	req := deploy.ManualComposeRequest{
		ServerID:    bodyString(body, "server_id"),
		ProjectName: bodyString(body, "project_name"),
		Compose:     bodyString(body, "compose"),
	}
	if err := requireManagedServerID(req.ServerID); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}
	ingressOptions := buildInstallIngressOptionsFromBody(e.Auth, body, nil)
	resolutionRequest := lifecyclesvc.BuildManualComposeInstallResolutionRequest(req, ingressOptions)

	result, err := createOperationFromCompose(
		e,
		resolutionRequest.ServerID,
		resolutionRequest.ProjectName,
		resolutionRequest.Compose,
		resolutionRequest.Source,
		resolutionRequest.Adapter,
		nil,
		operationCreateOptions{
			OperationType:      resolutionRequest.OperationType,
			ProjectDir:         resolutionRequest.ProjectDir,
			ComposeProjectName: resolutionRequest.ComposeProjectName,
			ResolvedEnv:        resolutionRequest.Env,
			ExposureIntent:     resolutionRequest.ExposureIntent,
			Metadata:           resolutionRequest.Metadata,
			RuntimeInputs:      resolutionRequest.RuntimeInputs,
			SourceBuild:        resolutionRequest.SourceBuild,
		},
	)
	if err != nil {
		if isOperationCreateConflict(err) {
			return e.JSON(http.StatusConflict, map[string]any{"code": 409, "message": err.Error()})
		}
		if isOperationCreateBadRequest(err) {
			return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
		}
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}

	return e.JSON(http.StatusAccepted, result)
}

// @Summary Check manual Compose install preflight
// @Description Resolves and validates a manual Compose install request without creating an action. Returns compose validity, duplicate-name checks, and host-port conflict findings when available. Superuser only.
// @Tags Actions
// @Security BearerAuth
// @Param body body object true "manual compose install preflight payload"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/actions/install/manual-compose/check [post]
func handleOperationInstallManualComposeCheck(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "invalid request body"})
	}

	req := deploy.ManualComposeRequest{
		ServerID:    bodyString(body, "server_id"),
		ProjectName: bodyString(body, "project_name"),
		Compose:     bodyString(body, "compose"),
	}
	if err := requireManagedServerID(req.ServerID); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}
	ingressOptions := buildInstallIngressOptionsFromBody(e.Auth, body, nil)
	resolutionRequest := lifecyclesvc.BuildManualComposeInstallResolutionRequest(req, ingressOptions)

	result, err := lifecyclesvc.CheckInstallFromCompose(
		e.App,
		lifecyclesvc.InstallPreflightRequest{InstallResolutionRequest: resolutionRequest},
		newRouteInstallPreflightProbe(e),
	)
	if err != nil {
		if isOperationCreateBadRequest(err) {
			return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
		}
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}

	return e.JSON(http.StatusOK, result)
}

func handleOperationInstallTemplate(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "invalid request body"})
	}
	if err := requireManagedServerID(bodyString(body, "server_id")); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}
	rendered, ingressOptions, err := renderTemplateInstall(e, body)
	if err != nil {
		if isOperationCreateBadRequest(err) || strings.Contains(strings.ToLower(err.Error()), "template ") {
			return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
		}
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}
	result, err := createOperationFromCompose(
		e,
		bodyString(body, "server_id"),
		rendered.ProjectName,
		rendered.Compose,
		deploy.SourceManualOps,
		deploy.AdapterManualCompose,
		map[string]any{
			"template_key": rendered.TemplateKey,
			"project_name": rendered.ProjectName,
		},
		operationCreateOptions{
			OperationType:      ingressOptions.OperationType,
			ProjectDir:         ingressOptions.ProjectDir,
			ComposeProjectName: firstNonEmptyString(ingressOptions.ComposeProjectName, rendered.ProjectName),
			ExposureIntent:     ingressOptions.ExposureIntent,
			Metadata:           ingressOptions.Metadata,
			RuntimeInputs:      ingressOptions.RuntimeInputs,
			SourceBuild:        ingressOptions.SourceBuild,
		},
	)
	if err != nil {
		if isOperationCreateConflict(err) {
			return e.JSON(http.StatusConflict, map[string]any{"code": 409, "message": err.Error()})
		}
		if isOperationCreateBadRequest(err) {
			return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
		}
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}
	return e.JSON(http.StatusAccepted, result)
}

func handleOperationInstallTemplateCheck(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "invalid request body"})
	}
	if err := requireManagedServerID(bodyString(body, "server_id")); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}
	rendered, ingressOptions, err := renderTemplateInstall(e, body)
	if err != nil {
		if isOperationCreateBadRequest(err) || strings.Contains(strings.ToLower(err.Error()), "template ") {
			return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
		}
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}
	result, err := lifecyclesvc.CheckInstallFromCompose(
		e.App,
		lifecyclesvc.InstallPreflightRequest{InstallResolutionRequest: lifecyclesvc.BuildInstallResolutionRequest(
			bodyString(body, "server_id"),
			rendered.ProjectName,
			rendered.Compose,
			deploy.SourceManualOps,
			deploy.AdapterManualCompose,
			ingressOptions,
		)},
		newRouteInstallPreflightProbe(e),
	)
	if err != nil {
		if isOperationCreateBadRequest(err) {
			return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
		}
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}
	return e.JSON(http.StatusOK, result)
}

func renderTemplateInstall(e *core.RequestEvent, body map[string]any) (*apptemplates.RenderedTemplate, lifecyclesvc.InstallIngressOptions, error) {
	serverID := bodyString(body, "server_id")
	if err := requireManagedServerID(serverID); err != nil {
		return nil, lifecyclesvc.InstallIngressOptions{}, err
	}
	templateKey := bodyString(body, "template_key")
	requestedExposure := lifecyclesvc.ParseExposureIntentMap(bodyMap(body, "exposure"))
	inputValues := copyAnyMap(bodyMap(body, "input_values"))
	if inputValues == nil {
		inputValues = map[string]any{}
	}
	if requestedExposure != nil && requestedExposure.ExposureType == "port" && requestedExposure.TargetPort > 0 {
		inputValues["http_port"] = requestedExposure.TargetPort
	}
	service := apptemplates.NewService()
	rendered, err := service.Render(e.App, apptemplates.RenderRequest{
		TemplateKey: templateKey,
		ProjectName: bodyString(body, "project_name"),
		Values:      inputValues,
		UserID:      authRecordID(e.Auth),
	})
	if err != nil {
		return nil, lifecyclesvc.InstallIngressOptions{}, err
	}
	if requestedExposure != nil && requestedExposure.ExposureType == "internal_only" {
		serviceName := firstNonEmptyString(
			firstTemplateExposureService(rendered.RenderExposures),
			firstPrimaryService(rendered.Manifest.ServiceRoles),
		)
		if serviceName != "" {
			rendered.Compose, err = removeComposeServicePorts(rendered.Compose, serviceName)
			if err != nil {
				return nil, lifecyclesvc.InstallIngressOptions{}, err
			}
		}
	}
	metadata := copyAnyMap(rendered.Metadata)
	ingressOptions := buildInstallIngressOptionsFromBody(e.Auth, body, metadata)
	if requestedExposure != nil {
		ingressOptions.ExposureIntent = requestedExposure
	} else {
		ingressOptions.ExposureIntent = lifecyclesvc.ParseExposureIntentMap(rendered.ExposureIntent)
	}
	if strings.TrimSpace(ingressOptions.ComposeProjectName) == "" {
		ingressOptions.ComposeProjectName = rendered.ProjectName
	}
	return rendered, ingressOptions, nil
}

func requireManagedServerID(serverID string) error {
	trimmed := strings.TrimSpace(serverID)
	if trimmed == "" {
		return fmt.Errorf("server_id is required")
	}
	if trimmed == "local" {
		return fmt.Errorf("local server targets are unsupported")
	}
	return nil
}

func firstTemplateExposureService(exposures []apptemplates.TemplateExposure) string {
	for _, exposure := range exposures {
		if strings.TrimSpace(exposure.Service) != "" {
			return strings.TrimSpace(exposure.Service)
		}
	}
	return ""
}

func firstPrimaryService(serviceRoles map[string]string) string {
	for name, role := range serviceRoles {
		if strings.TrimSpace(role) == "primary" {
			return strings.TrimSpace(name)
		}
	}
	return ""
}

func removeComposeServicePorts(compose, serviceName string) (string, error) {
	var doc map[string]any
	if err := yaml.Unmarshal([]byte(compose), &doc); err != nil {
		return "", err
	}
	services, ok := doc["services"].(map[string]any)
	if !ok {
		return compose, nil
	}
	service, ok := services[serviceName].(map[string]any)
	if !ok {
		return compose, nil
	}
	delete(service, "ports")
	encoded, err := yaml.Marshal(doc)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func authRecordID(record *core.Record) string {
	if record == nil {
		return ""
	}
	return strings.TrimSpace(record.Id)
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func copyAnyMap(source map[string]any) map[string]any {
	if len(source) == 0 {
		return nil
	}
	result := make(map[string]any, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func buildInstallIngressOptionsFromBody(auth *core.Record, body map[string]any, baseMetadata map[string]any) lifecyclesvc.InstallIngressOptions {
	userID := ""
	if auth != nil {
		userID = strings.TrimSpace(auth.Id)
	}
	return lifecyclesvc.BuildInstallIngressOptionsFromRaw(
		userID,
		"",
		"",
		"",
		bodyMap(body, "env"),
		bodyMap(body, "exposure"),
		mergeMetadata(baseMetadata, bodyMap(body, "metadata")),
		bodyMap(body, "runtime_inputs"),
		bodyMap(body, "source_build"),
		bodyInt64(body, "app_required_disk_bytes"),
		bodyFloat64(body, "app_required_disk_gib"),
	)
}

type operationCreateOptions struct {
	ExistingAppID      string
	OperationType      string
	ProjectDir         string
	ComposeProjectName string
	ResolvedEnv        map[string]any
	ExposureIntent     *lifecyclesvc.ExposureIntent
	Metadata           map[string]any
	RuntimeInputs      *lifecyclesvc.InstallRuntimeInputs
	SourceBuild        *lifecyclesvc.InstallSourceBuildInput
}

func createOperationFromCompose(
	e *core.RequestEvent,
	serverID string,
	projectName string,
	compose string,
	source string,
	adapter string,
	auditDetail map[string]any,
	options operationCreateOptions,
) (map[string]any, error) {
	operationRecord, err := lifecyclesvc.PreflightAndCreateOperationFromCompose(
		e.App,
		e.Auth,
		lifecyclesvc.ComposeOperationRequest{
			ServerID:       serverID,
			ProjectName:    projectName,
			Compose:        compose,
			Source:         source,
			Adapter:        adapter,
			ResolvedEnv:    options.ResolvedEnv,
			ExposureIntent: options.ExposureIntent,
			Metadata:       options.Metadata,
			RuntimeInputs:  options.RuntimeInputs,
			SourceBuild:    options.SourceBuild,
		},
		lifecyclesvc.ComposeOperationOptions{
			ExistingAppID:      options.ExistingAppID,
			OperationType:      options.OperationType,
			ProjectDir:         options.ProjectDir,
			ComposeProjectName: options.ComposeProjectName,
		},
		newRouteInstallPreflightProbe(e),
	)
	if err != nil {
		return nil, err
	}

	userID, userEmail, ip, ua := clientInfo(e)
	detail := map[string]any{
		"source":  source,
		"adapter": adapter,
	}
	composeProjectName := operationRecord.GetString("compose_project_name")
	for key, value := range auditDetail {
		detail[key] = value
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		UserEmail:    userEmail,
		Action:       "operation.create",
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
	enqueued := false
	if asynqClient != nil {
		if err := worker.EnqueueOperation(asynqClient, operationRecord.Id); err == nil {
			enqueued = true
		}
	}
	result["enqueued"] = enqueued
	return result, nil
}

func isOperationActive(record *core.Record) bool {
	return strings.TrimSpace(record.GetString("terminal_status")) == ""
}

func isOperationCreateBadRequest(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(message, "compose") ||
		strings.Contains(message, "env ") ||
		strings.Contains(message, "unsupported env") ||
		strings.Contains(message, "runtime_inputs") ||
		strings.Contains(message, "source_build") ||
		strings.Contains(message, "target_port") ||
		strings.Contains(message, "exposure") ||
		strings.Contains(message, "source_path") ||
		strings.Contains(message, "mount_path") ||
		strings.Contains(message, "builder_strategy") ||
		strings.Contains(message, "image_name") ||
		strings.Contains(message, "target_ref") ||
		strings.Contains(message, "secret ")
}

func isOperationCreateConflict(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(message, "already exists") || strings.Contains(message, "duplicate") || strings.Contains(message, "preflight blocked")
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
	case string(model.OperationPhaseQueued):
		return deploy.StatusQueued
	case string(model.OperationPhaseValidating):
		return deploy.StatusValidating
	case string(model.OperationPhasePreparing):
		return deploy.StatusPreparing
	case string(model.OperationPhaseExecuting):
		return deploy.StatusRunning
	case string(model.OperationPhaseVerifying):
		return deploy.StatusVerifying
	case string(model.OperationPhaseCompensating):
		return deploy.StatusRollingBack
	default:
		return deploy.StatusQueued
	}
}

type operationListQueryOptions struct {
	AppID         string
	Query         string
	SortField     string
	SortDir       string
	ExcludeStatus []string
	ExcludeSource []string
	ExcludeServer []string
	Page          int
	PerPage       int
}

func listOperationRecords(app core.App, col *core.Collection, options operationListQueryOptions) ([]*core.Record, int, error) {
	records, err := app.FindRecordsByFilter(col, "", operationListSortExpr(options.SortField, options.SortDir), 0, 0)
	if err != nil {
		return nil, 0, err
	}

	filtered := make([]*core.Record, 0, len(records))
	query := strings.ToLower(strings.TrimSpace(options.Query))
	excludedStatus := sliceToSet(options.ExcludeStatus)
	excludedSource := sliceToSet(options.ExcludeSource)
	excludedServer := sliceToSet(options.ExcludeServer)
	for _, record := range records {
		if options.AppID != "" && strings.TrimSpace(record.GetString("app")) != options.AppID {
			continue
		}

		status := operationDisplayStatus(record)
		if _, blocked := excludedStatus[status]; blocked {
			continue
		}
		source := strings.TrimSpace(record.GetString("trigger_source"))
		if _, blocked := excludedSource[source]; blocked {
			continue
		}
		serverID := normalizeOperationServerID(record.GetString("server_id"))
		if _, blocked := excludedServer[serverID]; blocked {
			continue
		}
		if query != "" && !operationRecordMatchesQuery(record, status, query) {
			continue
		}

		filtered = append(filtered, record)
	}

	totalItems := len(filtered)
	perPage := options.PerPage
	if perPage <= 0 {
		perPage = 15
	}
	page := options.Page
	if page <= 0 {
		page = 1
	}
	if totalItems == 0 {
		return []*core.Record{}, 0, nil
	}
	totalPages := max(1, (totalItems+perPage-1)/perPage)
	if page > totalPages {
		page = totalPages
	}
	offset := (page - 1) * perPage
	end := min(offset+perPage, totalItems)
	return filtered[offset:end], totalItems, nil
}

func operationListSortExpr(field string, dir string) string {
	prefix := "-"
	if strings.EqualFold(strings.TrimSpace(dir), "asc") {
		prefix = ""
	}
	switch strings.TrimSpace(field) {
	case "compose_project_name", "created", "started_at", "finished_at":
		return prefix + strings.TrimSpace(field)
	default:
		return "-created"
	}
}

func operationRecordMatchesQuery(record *core.Record, status string, query string) bool {
	values := []string{
		record.Id,
		record.GetString("compose_project_name"),
		record.GetString("trigger_source"),
		normalizeOperationServerID(record.GetString("server_id")),
		status,
	}
	for _, value := range values {
		if strings.Contains(strings.ToLower(strings.TrimSpace(value)), query) {
			return true
		}
	}
	return false
}

func splitOperationListCSV(raw string) []string {
	parts := strings.Split(raw, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		values = append(values, trimmed)
	}
	return values
}

func sliceToSet(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		result[trimmed] = struct{}{}
	}
	return result
}

func normalizeOperationServerID(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "local"
	}
	return trimmed
}

func operationRecordResponse(app core.App, record *core.Record) (map[string]any, error) {
	pipelineRunID := record.GetString("pipeline_run")
	stepRuns, err := findPipelineNodeRuns(app, pipelineRunID)
	if err != nil {
		return nil, err
	}
	pipelinePayload, err := buildPipelineResponse(app, pipelineRunID, record, stepRuns)
	if err != nil {
		return nil, err
	}
	result := map[string]any{
		"id":                       record.Id,
		"app_id":                   record.GetString("app"),
		"server_id":                record.GetString("server_id"),
		"source":                   record.GetString("trigger_source"),
		"status":                   operationDisplayStatus(record),
		"adapter":                  record.GetString("adapter"),
		"compose_project_name":     record.GetString("compose_project_name"),
		"project_dir":              record.GetString("project_dir"),
		"rendered_compose":         record.GetString("rendered_compose"),
		"error_summary":            record.GetString("error_message"),
		"has_execution_log":        strings.TrimSpace(record.GetString("execution_log")) != "",
		"pipeline":                 pipelinePayload,
		"pipeline_family":          pipelinePayload["family"],
		"pipeline_family_internal": pipelinePayload["family_internal"],
		"pipeline_definition_key":  pipelinePayload["definition_key"],
		"pipeline_version":         pipelinePayload["version"],
		"pipeline_selector":        pipelinePayload["selector"],
		"created":                  record.GetDateTime("created").String(),
		"updated":                  record.GetDateTime("updated").String(),
		"spec":                     record.Get("spec_json"),
		"lifecycle":                buildOperationLifecycle(record),
		"steps":                    buildOperationSteps(stepRuns),
	}
	if value := record.GetDateTime("started_at"); !value.IsZero() {
		result["started_at"] = value.String()
	}
	if value := record.GetDateTime("ended_at"); !value.IsZero() {
		result["finished_at"] = value.String()
	}
	return result, nil
}

func pipelineRunRecordResponse(app core.App, pipelineRunRecord *core.Record) (map[string]any, error) {
	operationRecord, err := app.FindRecordById("app_operations", pipelineRunRecord.GetString("operation"))
	if err != nil {
		return nil, err
	}
	stepRuns, err := findPipelineNodeRuns(app, pipelineRunRecord.Id)
	if err != nil {
		return nil, err
	}
	return buildPipelineResponse(app, pipelineRunRecord.Id, operationRecord, stepRuns)
}

func buildPipelineResponse(app core.App, pipelineRunID string, record *core.Record, stepRuns []*core.Record) (map[string]any, error) {
	var pipelineFamily string
	var pipelineDefinitionKey string
	var pipelineVersion string
	var pipelineStatus string
	var currentPhase string
	var failedNodeKey string
	var nodeCount int
	var completedNodeCount int
	var createdAt string
	var updatedAt string
	var startedAt string
	var finishedAt string
	if strings.TrimSpace(pipelineRunID) != "" {
		pipelineRunRecord, err := app.FindRecordById("pipeline_runs", pipelineRunID)
		if err != nil {
			return nil, err
		}
		pipelineFamily = pipelineRunRecord.GetString("pipeline_family")
		pipelineDefinitionKey = pipelineRunRecord.GetString("pipeline_definition_key")
		pipelineVersion = pipelineRunRecord.GetString("pipeline_version")
		pipelineStatus = pipelineRunRecord.GetString("status")
		currentPhase = pipelineRunRecord.GetString("current_phase")
		failedNodeKey = pipelineRunRecord.GetString("failed_node_key")
		nodeCount = pipelineRunRecord.GetInt("node_count")
		completedNodeCount = pipelineRunRecord.GetInt("completed_node_count")
		createdAt = pipelineRunRecord.GetDateTime("created").String()
		updatedAt = pipelineRunRecord.GetDateTime("updated").String()
		if value := pipelineRunRecord.GetDateTime("started_at"); !value.IsZero() {
			startedAt = value.String()
		}
		if value := pipelineRunRecord.GetDateTime("ended_at"); !value.IsZero() {
			finishedAt = value.String()
		}
	}
	result := map[string]any{
		"id":                   pipelineRunID,
		"operation_id":         record.Id,
		"app_id":               record.GetString("app"),
		"server_id":            record.GetString("server_id"),
		"family":               externalPipelineFamilyKey(pipelineFamily),
		"family_internal":      pipelineFamily,
		"definition_key":       pipelineDefinitionKey,
		"version":              pipelineVersion,
		"status":               pipelineStatus,
		"current_phase":        currentPhase,
		"node_count":           nodeCount,
		"completed_node_count": completedNodeCount,
		"failed_node_key":      failedNodeKey,
		"selector": map[string]any{
			"operation_type": record.GetString("operation_type"),
			"source":         record.GetString("trigger_source"),
			"adapter":        record.GetString("adapter"),
		},
		"steps": buildOperationSteps(stepRuns),
	}
	if createdAt != "" {
		result["created"] = createdAt
	}
	if updatedAt != "" {
		result["updated"] = updatedAt
	}
	if startedAt != "" {
		result["started_at"] = startedAt
	}
	if finishedAt != "" {
		result["finished_at"] = finishedAt
	}
	return result, nil
}

func externalPipelineFamilyKey(family string) string {
	switch strings.TrimSpace(family) {
	case "ProvisionPipeline":
		return "provision"
	case "ChangePipeline":
		return "change"
	case "ExposurePipeline":
		return "exposure"
	case "RecoveryPipeline":
		return "recovery"
	case "MaintenancePipeline":
		return "maintenance"
	case "RetirePipeline":
		return "retire"
	default:
		return strings.TrimSpace(family)
	}
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
			{"key": string(model.PipelinePhaseValidating), "label": "Validating", "status": "pending"},
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
		if executionLog := nodeRun.GetString("execution_log"); executionLog != "" {
			step["execution_log"] = executionLog
		}
		if nodeRun.GetBool("execution_log_truncated") {
			step["execution_log_truncated"] = true
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
