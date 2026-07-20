package routes

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/worker"
	"github.com/websoft9/appos/backend/domain/workflow"
	"github.com/websoft9/appos/backend/infra/persistence"
)

type workflowDefinitionWriteRequest struct {
	Name            string `json:"name"`
	Description     string `json:"description"`
	IsEnabled       bool   `json:"is_enabled"`
	DefinitionYAML  string `json:"definition_yaml"`
	DefaultServerID string `json:"default_server_id"`
}

type workflowRunRequest struct {
	Params map[string]any `json:"params"`
}

func registerWorkflowRoutes(se *core.ServeEvent) {
	read := se.Router.Group("/api/workflows")
	read.Bind(apis.RequireAuth())
	read.Bind(apis.RequireSuperuserAuth())

	write := se.Router.Group("/api/workflows")
	write.Bind(apis.RequireAuth())
	write.Bind(apis.RequireSuperuserAuth())

	runs := se.Router.Group("/api/workflow-runs")
	runs.Bind(apis.RequireAuth())
	runs.Bind(apis.RequireSuperuserAuth())

	read.GET("", handleWorkflowList)
	read.GET("/{id}", handleWorkflowGet)
	read.GET("/{id}/runs", handleWorkflowRunList)

	write.POST("", handleWorkflowCreate)
	write.PUT("/{id}", handleWorkflowUpdate)
	write.DELETE("/{id}", handleWorkflowDelete)
	write.POST("/{id}/run", handleWorkflowRunCreate)

	runs.GET("/{runId}", handleWorkflowRunGet)
	runs.GET("/{runId}/nodes", handleWorkflowNodeRunList)
	runs.POST("/{runId}/cancel", handleWorkflowRunCancel)
	runs.POST("/{runId}/approve/{nodeKey}", handleWorkflowNodeApprove)
	runs.POST("/{runId}/reject/{nodeKey}", handleWorkflowNodeReject)
}

// handleWorkflowList lists workflow definitions.
//
// @Summary List workflows
// @Description Returns all workflow definitions. Authenticated users only.
// @Tags Workflow
// @Security BearerAuth
// @Success 200 {array} workflow.DefinitionRecord
// @Failure 401 {object} map[string]any
// @Router /api/workflows [get]
func handleWorkflowList(e *core.RequestEvent) error {
	svc := workflow.NewService(persistence.NewWorkflowRepository(e.App))
	items, err := svc.ListDefinitions(context.Background())
	if err != nil {
		return e.InternalServerError("failed to list workflows", err)
	}
	return e.JSON(http.StatusOK, items)
}

// handleWorkflowGet returns one workflow definition.
//
// @Summary Get workflow
// @Description Returns one workflow definition by id. Authenticated users only.
// @Tags Workflow
// @Security BearerAuth
// @Param id path string true "workflow id"
// @Success 200 {object} workflow.DefinitionRecord
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/workflows/{id} [get]
func handleWorkflowGet(e *core.RequestEvent) error {
	svc := workflow.NewService(persistence.NewWorkflowRepository(e.App))
	item, err := svc.GetDefinition(context.Background(), e.Request.PathValue("id"))
	if err != nil {
		return mapWorkflowError(e, err)
	}
	return e.JSON(http.StatusOK, item)
}

// handleWorkflowCreate creates one workflow definition.
//
// @Summary Create workflow
// @Description Creates one workflow definition. Superuser only.
// @Tags Workflow
// @Security BearerAuth
// @Param body body workflowDefinitionWriteRequest true "workflow payload"
// @Success 201 {object} workflow.DefinitionRecord
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Router /api/workflows [post]
func handleWorkflowCreate(e *core.RequestEvent) error {
	var req workflowDefinitionWriteRequest
	if err := e.BindBody(&req); err != nil {
		return e.BadRequestError("Invalid request body", err)
	}
	svc := workflow.NewService(persistence.NewWorkflowRepository(e.App))
	item, err := svc.CreateDefinition(context.Background(), workflow.CreateDefinitionInput{
		Name:            req.Name,
		Description:     req.Description,
		IsEnabled:       req.IsEnabled,
		DefinitionYAML:  req.DefinitionYAML,
		DefaultServerID: req.DefaultServerID,
		CreatedBy:       authID(e),
	})
	if err != nil {
		return mapWorkflowError(e, err)
	}
	return e.JSON(http.StatusCreated, item)
}

// handleWorkflowUpdate updates one workflow definition.
//
// @Summary Update workflow
// @Description Updates one workflow definition. Superuser only.
// @Tags Workflow
// @Security BearerAuth
// @Param id path string true "workflow id"
// @Param body body workflowDefinitionWriteRequest true "workflow payload"
// @Success 200 {object} workflow.DefinitionRecord
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/workflows/{id} [put]
func handleWorkflowUpdate(e *core.RequestEvent) error {
	var req workflowDefinitionWriteRequest
	if err := e.BindBody(&req); err != nil {
		return e.BadRequestError("Invalid request body", err)
	}
	svc := workflow.NewService(persistence.NewWorkflowRepository(e.App))
	item, err := svc.UpdateDefinition(context.Background(), e.Request.PathValue("id"), workflow.UpdateDefinitionInput{
		Name:            req.Name,
		Description:     req.Description,
		IsEnabled:       req.IsEnabled,
		DefinitionYAML:  req.DefinitionYAML,
		DefaultServerID: req.DefaultServerID,
	})
	if err != nil {
		return mapWorkflowError(e, err)
	}
	return e.JSON(http.StatusOK, item)
}

// handleWorkflowDelete deletes one workflow definition.
//
// @Summary Delete workflow
// @Description Deletes one workflow definition. Superuser only.
// @Tags Workflow
// @Security BearerAuth
// @Param id path string true "workflow id"
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/workflows/{id} [delete]
func handleWorkflowDelete(e *core.RequestEvent) error {
	repo := persistence.NewWorkflowRepository(e.App)
	if err := repo.DeleteDefinition(context.Background(), e.Request.PathValue("id")); err != nil {
		return mapWorkflowError(e, err)
	}
	return e.JSON(http.StatusOK, map[string]any{"ok": true})
}

// handleWorkflowRunCreate prepares and enqueues one manual workflow run.
//
// @Summary Run workflow
// @Description Creates and enqueues one manual workflow run. Superuser only.
// @Tags Workflow
// @Security BearerAuth
// @Param id path string true "workflow id"
// @Param body body workflowRunRequest false "run payload"
// @Success 202 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/workflows/{id}/run [post]
func handleWorkflowRunCreate(e *core.RequestEvent) error {
	var req workflowRunRequest
	if err := e.BindBody(&req); err != nil && !errors.Is(err, http.ErrBodyNotAllowed) {
		return e.BadRequestError("Invalid request body", err)
	}
	if req.Params == nil {
		req.Params = map[string]any{}
	}
	repo := persistence.NewWorkflowRepository(e.App)
	svc := workflow.NewService(repo)
	prepared, err := svc.PrepareRun(context.Background(), workflow.PrepareRunInput{
		WorkflowID:       e.Request.PathValue("id"),
		TriggerType:      workflow.TriggerManual,
		ExecutionOwnerID: authID(e),
		RequestedBy:      authID(e),
		RequestedByEmail: authEmail(e),
		Params:           req.Params,
	})
	if err != nil {
		if errors.Is(err, workflow.ErrOverlapSkipped) {
			return e.JSON(http.StatusAccepted, map[string]any{"accepted": false, "message": "workflow run skipped by overlap policy"})
		}
		return mapWorkflowError(e, err)
	}
	if asynqClient == nil {
		return e.InternalServerError("asynq client is not configured", nil)
	}
	if err := worker.EnqueueWorkflowRun(asynqClient, prepared.Run.ID); err != nil {
		message := err.Error()
		failed := workflow.RunStatusFailed
		_, _ = repo.UpdateRun(context.Background(), prepared.Run.ID, workflow.UpdateRunInput{Status: &failed, ErrorMessage: &message})
		return e.InternalServerError("failed to enqueue workflow run", err)
	}
	return e.JSON(http.StatusAccepted, map[string]any{"accepted": true, "run": prepared.Run})
}

// handleWorkflowRunList lists workflow runs for one workflow definition.
//
// @Summary List workflow runs
// @Description Returns workflow runs for one workflow definition. Authenticated users only.
// @Tags Workflow
// @Security BearerAuth
// @Param id path string true "workflow id"
// @Success 200 {array} workflow.RunRecord
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/workflows/{id}/runs [get]
func handleWorkflowRunList(e *core.RequestEvent) error {
	repo := persistence.NewWorkflowRepository(e.App)
	items, err := repo.ListRunsByWorkflow(context.Background(), e.Request.PathValue("id"))
	if err != nil {
		return mapWorkflowError(e, err)
	}
	return e.JSON(http.StatusOK, items)
}

// handleWorkflowRunGet returns one workflow run.
//
// @Summary Get workflow run
// @Description Returns one workflow run by id. Superuser only.
// @Tags Workflow
// @Security BearerAuth
// @Param runId path string true "workflow run id"
// @Success 200 {object} workflow.RunRecord
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/workflow-runs/{runId} [get]
func handleWorkflowRunGet(e *core.RequestEvent) error {
	repo := persistence.NewWorkflowRepository(e.App)
	item, err := repo.GetRun(context.Background(), e.Request.PathValue("runId"))
	if err != nil {
		return mapWorkflowError(e, err)
	}
	return e.JSON(http.StatusOK, item)
}

// handleWorkflowNodeRunList lists node runs for one workflow run.
//
// @Summary List workflow node runs
// @Description Returns node runs for one workflow run. Superuser only.
// @Tags Workflow
// @Security BearerAuth
// @Param runId path string true "workflow run id"
// @Success 200 {array} workflow.NodeRunRecord
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/workflow-runs/{runId}/nodes [get]
func handleWorkflowNodeRunList(e *core.RequestEvent) error {
	repo := persistence.NewWorkflowRepository(e.App)
	items, err := repo.ListNodeRunsByRun(context.Background(), e.Request.PathValue("runId"))
	if err != nil {
		return mapWorkflowError(e, err)
	}
	return e.JSON(http.StatusOK, items)
}

// handleWorkflowRunCancel cancels one workflow run.
//
// @Summary Cancel workflow run
// @Description Marks one workflow run cancelled. Superuser only.
// @Tags Workflow
// @Security BearerAuth
// @Param runId path string true "workflow run id"
// @Success 200 {object} workflow.RunRecord
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/workflow-runs/{runId}/cancel [post]
func handleWorkflowRunCancel(e *core.RequestEvent) error {
	repo := persistence.NewWorkflowRepository(e.App)
	run, err := repo.GetRun(context.Background(), e.Request.PathValue("runId"))
	if err != nil {
		return mapWorkflowError(e, err)
	}
	if run.Status == workflow.RunStatusSucceeded || run.Status == workflow.RunStatusFailed || run.Status == workflow.RunStatusCancelled {
		return e.BadRequestError("workflow run is already terminal", nil)
	}
	if run.Status == workflow.RunStatusPending || run.Status == workflow.RunStatusRunning || run.Status == workflow.RunStatusWaiting || run.Status == workflow.RunStatusManualGate {
		status := workflow.RunStatusCancelled
		now := time.Now().UTC().Format(time.RFC3339)
		item, err := repo.UpdateRun(context.Background(), e.Request.PathValue("runId"), workflow.UpdateRunInput{Status: &status, EndedAt: &now})
		if err != nil {
			return mapWorkflowError(e, err)
		}
		return e.JSON(http.StatusOK, item)
	}
	status := workflow.RunStatusCancelled
	now := time.Now().UTC().Format(time.RFC3339)
	item, err := repo.UpdateRun(context.Background(), e.Request.PathValue("runId"), workflow.UpdateRunInput{Status: &status, EndedAt: &now})
	if err != nil {
		return mapWorkflowError(e, err)
	}
	return e.JSON(http.StatusOK, item)
}

// handleWorkflowNodeApprove approves one manual-gate node run.
//
// @Summary Approve workflow node
// @Description Approves one workflow node run. Superuser only.
// @Tags Workflow
// @Security BearerAuth
// @Param runId path string true "workflow run id"
// @Param nodeKey path string true "node key"
// @Success 200 {object} workflow.NodeRunRecord
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/workflow-runs/{runId}/approve/{nodeKey} [post]
func handleWorkflowNodeApprove(e *core.RequestEvent) error {
	return updateWorkflowNodeDecision(e, workflow.NodeStatusSucceeded)
}

// handleWorkflowNodeReject rejects one manual-gate node run.
//
// @Summary Reject workflow node
// @Description Rejects one workflow node run. Superuser only.
// @Tags Workflow
// @Security BearerAuth
// @Param runId path string true "workflow run id"
// @Param nodeKey path string true "node key"
// @Success 200 {object} workflow.NodeRunRecord
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/workflow-runs/{runId}/reject/{nodeKey} [post]
func handleWorkflowNodeReject(e *core.RequestEvent) error {
	return updateWorkflowNodeDecision(e, workflow.NodeStatusCancelled)
}

func updateWorkflowNodeDecision(e *core.RequestEvent, status string) error {
	repo := persistence.NewWorkflowRepository(e.App)
	run, err := repo.GetRun(context.Background(), e.Request.PathValue("runId"))
	if err != nil {
		return mapWorkflowError(e, err)
	}
	if run.Status != workflow.RunStatusManualGate && run.Status != workflow.RunStatusWaiting && run.Status != workflow.RunStatusRunning {
		return e.BadRequestError("workflow run is not awaiting node decision", nil)
	}
	nodes, err := repo.ListNodeRunsByRun(context.Background(), e.Request.PathValue("runId"))
	if err != nil {
		return mapWorkflowError(e, err)
	}
	for _, node := range nodes {
		if node.NodeKey != e.Request.PathValue("nodeKey") {
			continue
		}
		if node.Status != workflow.NodeStatusManualGate {
			return e.BadRequestError("workflow node is not awaiting manual gate decision", nil)
		}
		updated, updateErr := repo.UpdateNodeRun(context.Background(), node.ID, workflow.UpdateNodeRunInput{Status: &status})
		if updateErr != nil {
			return mapWorkflowError(e, updateErr)
		}
		if status == workflow.NodeStatusSucceeded && asynqClient != nil {
			_ = worker.EnqueueWorkflowRun(asynqClient, run.ID)
		} else if status == workflow.NodeStatusCancelled {
			runStatus := workflow.RunStatusCancelled
			now := time.Now().UTC().Format(time.RFC3339)
			_, _ = repo.UpdateRun(context.Background(), run.ID, workflow.UpdateRunInput{Status: &runStatus, EndedAt: &now})
		}
		return e.JSON(http.StatusOK, updated)
	}
	return e.NotFoundError("Workflow node run not found", sql.ErrNoRows)
}

func mapWorkflowError(e *core.RequestEvent, err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return e.NotFoundError("Workflow not found", err)
	}
	message := strings.TrimSpace(err.Error())
	if message == "" {
		message = "workflow error"
	}
	if strings.Contains(message, "required") || strings.Contains(message, "requires") || strings.Contains(message, "unsupported") || strings.Contains(message, "duplicate") || strings.Contains(message, "unknown node") || strings.Contains(message, "cycle") {
		return e.BadRequestError(message, nil)
	}
	return e.InternalServerError(message, err)
}

func authID(e *core.RequestEvent) string {
	if e.Auth == nil {
		return ""
	}
	return e.Auth.Id
}

func authEmail(e *core.RequestEvent) string {
	if e.Auth == nil {
		return ""
	}
	return e.Auth.GetString("email")
}
