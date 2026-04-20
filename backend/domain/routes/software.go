package routes

import (
	"errors"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/domain/software"
	swservice "github.com/websoft9/appos/backend/domain/software/service"
	"github.com/websoft9/appos/backend/domain/worker"
	"github.com/websoft9/appos/backend/infra/collections"
)

// registerSoftwareRoutes mounts the software delivery routes under
// /api/servers/{serverId}/software.
func registerSoftwareRoutes(servers *router.RouterGroup[*core.RequestEvent]) {
	sw := servers.Group("/{serverId}/software")
	sw.GET("/capabilities", handleSoftwareCapabilityList)
	sw.GET("/operations/{operationId}", handleSoftwareOperationGet)
	sw.GET("/operations", handleSoftwareOperationList)
	sw.GET("", handleSoftwareComponentList)
	sw.GET("/{componentKey}", handleSoftwareComponentGet)
	sw.POST("/{componentKey}/{action}", handleSoftwareComponentAction)
}

// registerLocalSoftwareRoutes mounts the AppOS-local software inventory routes under
// /api/software/local.
func registerLocalSoftwareRoutes(api *router.RouterGroup[*core.RequestEvent]) {
	local := api.Group("/local")
	local.GET("", handleLocalSoftwareComponentList)
	local.GET("/{componentKey}", handleLocalSoftwareComponentGet)
}

// @Summary Get a software delivery operation
// @Description Returns the current state of one async software delivery operation.
// @Tags Software
// @Security BearerAuth
// @Param serverId path string true "Server ID"
// @Param operationId path string true "Operation ID"
// @Success 200 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/servers/{serverId}/software/operations/{operationId} [get]
func handleSoftwareOperationGet(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	operationID := e.Request.PathValue("operationId")

	record, err := e.App.FindRecordById(collections.SoftwareOperations, operationID)
	if err != nil {
		return e.JSON(http.StatusNotFound, map[string]any{
			"error":   "operation_not_found",
			"message": "software operation not found",
		})
	}
	if record.GetString("server_id") != serverID {
		return e.JSON(http.StatusNotFound, map[string]any{
			"error":   "operation_not_found",
			"message": "software operation not found",
		})
	}

	return e.JSON(http.StatusOK, record)
}

// @Summary List software delivery operations
// @Description Returns recent software delivery operations for a server.
// @Tags Software
// @Security BearerAuth
// @Param serverId path string true "Server ID"
// @Param component query string false "Filter by component key"
// @Success 200 {object} map[string]any
// @Router /api/servers/{serverId}/software/operations [get]
func handleSoftwareOperationList(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	componentKey := e.Request.URL.Query().Get("component")

	filter := "server_id = '" + escapeSoftwareFilterValue(serverID) + "'"
	if componentKey != "" {
		filter += " && component_key = '" + escapeSoftwareFilterValue(componentKey) + "'"
	}

	col, err := e.App.FindCollectionByNameOrId(collections.SoftwareOperations)
	if err != nil {
		return e.JSON(http.StatusOK, map[string]any{"items": []any{}})
	}

	records, err := e.App.FindRecordsByFilter(col, filter, "-created", 50, 0)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "query_failed",
			"message": err.Error(),
		})
	}

	return e.JSON(http.StatusOK, map[string]any{"items": records})
}

// escapeSoftwareFilterValue sanitizes a value for use in a PocketBase filter string
// by escaping single quotes. This is used for server_id and component_key query params
// which are validated identifiers, not arbitrary user content.
func escapeSoftwareFilterValue(v string) string {
	return escapePBFilterValue(v)
}

// validSoftwareActions maps URL action path segments to their software.Action constants.
var validSoftwareActions = map[string]software.Action{
	"install": software.ActionInstall,
	"upgrade": software.ActionUpgrade,
	"verify":  software.ActionVerify,
	"repair":  software.ActionRepair,
}

// @Summary Invoke a software delivery action
// @Description Enqueues an async software delivery action (install, upgrade, verify, repair) for a component on the given server.
// @Tags Software
// @Security BearerAuth
// @Param serverId path string true "Server ID"
// @Param componentKey path string true "Component key (e.g. docker, monitor-agent)"
// @Param action path string true "Action name: install | upgrade | verify | repair"
// @Success 202 {object} map[string]any
// @Failure 400 {object} map[string]any "invalid action"
// @Failure 503 {object} map[string]any "queue not configured"
// @Router /api/servers/{serverId}/software/{componentKey}/{action} [post]
func handleSoftwareComponentAction(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	componentKey := software.ComponentKey(e.Request.PathValue("componentKey"))
	actionStr := e.Request.PathValue("action")

	act, ok := validSoftwareActions[actionStr]
	if !ok {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error":   "invalid_action",
			"message": "action must be one of: install, upgrade, verify, repair",
		})
	}

	if asynqClient == nil {
		return e.JSON(http.StatusServiceUnavailable, map[string]any{
			"error":   "queue_unavailable",
			"message": "background task queue is not configured",
		})
	}

	record, err := worker.PrepareSoftwareOperation(e.App, serverID, componentKey, act)
	if err != nil {
		if errors.Is(err, worker.ErrSoftwareOperationInFlight) {
			return e.JSON(http.StatusConflict, map[string]any{
				"error":   "operation_in_flight",
				"message": err.Error(),
			})
		}
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "operation_prepare_failed",
			"message": err.Error(),
		})
	}

	userID, userEmail, _, _ := clientInfo(e)
	if err := worker.EnqueueSoftwareAction(asynqClient, record.Id, serverID, componentKey, act, userID, userEmail); err != nil {
		markSoftwareOperationEnqueueFailed(e, record, err)
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "enqueue_failed",
			"message": err.Error(),
		})
	}

	return e.JSON(http.StatusAccepted, software.AsyncCommandResponse{
		Accepted:    true,
		OperationID: record.Id,
		Phase:       software.OperationPhaseAccepted,
		Message:     actionStr + " accepted",
	})
}

func markSoftwareOperationEnqueueFailed(e *core.RequestEvent, record *core.Record, enqueueErr error) {
	record.Set("phase", string(software.OperationPhaseFailed))
	record.Set("terminal_status", string(software.TerminalStatusFailed))
	record.Set("failure_reason", "enqueue failed: "+enqueueErr.Error())
	if err := e.App.Save(record); err != nil {
		e.App.Logger().Error("save failed software operation after enqueue error", "operation_id", record.Id, "err", err)
	}
}

// ─── Component inventory handlers ─────────────────────────────────────────────

type softwareLastOpSummary struct {
	Action         software.Action         `json:"action"`
	Phase          software.OperationPhase `json:"phase"`
	TerminalStatus software.TerminalStatus `json:"terminal_status"`
	FailureReason  string                  `json:"failure_reason,omitempty"`
	UpdatedAt      string                  `json:"updated_at"`
}

type softwareComponentListItem struct {
	software.SoftwareComponentSummary
	TargetType    software.TargetType             `json:"target_type"`
	Preflight     *software.TargetReadinessResult `json:"preflight,omitempty"`
	LastOperation *swservice.OperationSummary     `json:"last_operation,omitempty"`
}

type softwareComponentDetailResponse struct {
	software.SoftwareComponentDetail
	TargetType    software.TargetType         `json:"target_type"`
	LastOperation *swservice.OperationSummary `json:"last_operation,omitempty"`
}

// @Summary List software components for a server
// @Description Returns the catalog components for a managed server with their latest installed and verification state.
// @Tags Software
// @Security BearerAuth
// @Param serverId path string true "Server ID"
// @Success 200 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/software [get]
func handleSoftwareComponentList(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	userID, _, _, _ := clientInfo(e)

	computed, err := swservice.New(e.App, asynqClient).ListServerComponents(e.Request.Context(), serverID, userID)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "catalog_load_failed",
			"message": err.Error(),
		})
	}
	items := make([]softwareComponentListItem, 0, len(computed))
	for _, item := range computed {
		items = append(items, softwareComponentListItem{
			SoftwareComponentSummary: item.Summary,
			TargetType:               item.Entry.TargetType,
			Preflight:                item.Detail.Preflight,
			LastOperation:            item.LastOperation,
		})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"server_id": serverID,
		"items":     items,
	})
}

// @Summary Get a single software component for a server
// @Description Returns catalog metadata and the latest installed/verification state for one component.
// @Tags Software
// @Security BearerAuth
// @Param serverId path string true "Server ID"
// @Param componentKey path string true "Component key (e.g. docker, monitor-agent)"
// @Success 200 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/software/{componentKey} [get]
func handleSoftwareComponentGet(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	componentKey := software.ComponentKey(e.Request.PathValue("componentKey"))
	userID, _, _, _ := clientInfo(e)

	item, err := swservice.New(e.App, asynqClient).GetServerComponent(e.Request.Context(), serverID, userID, componentKey)
	if err != nil {
		status := http.StatusInternalServerError
		errorCode := "catalog_load_failed"
		if strings.Contains(err.Error(), "not found in server catalog") {
			status = http.StatusNotFound
			errorCode = "component_not_found"
		}
		return e.JSON(status, map[string]any{
			"error":   errorCode,
			"message": err.Error(),
		})
	}
	return e.JSON(http.StatusOK, softwareComponentDetailResponse{
		SoftwareComponentDetail: item.Detail,
		TargetType:              item.Entry.TargetType,
		LastOperation:           item.LastOperation,
	})
}

// ─── Capability handlers ───────────────────────────────────────────────────────

// softwareCapabilityResponse is the per-capability shape returned by the capabilities endpoint.
// @Summary List capability readiness for a server
// @Description Returns readiness status for each AppOS-managed capability on the given server.
// @Tags Software
// @Security BearerAuth
// @Param serverId path string true "Server ID"
// @Success 200 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/software/capabilities [get]
func handleSoftwareCapabilityList(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	items, err := swservice.New(e.App, asynqClient).ListCapabilities(e.Request.Context(), serverID)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "catalog_load_failed",
			"message": err.Error(),
		})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"server_id": serverID,
		"items":     items,
	})
}

// @Summary List AppOS-local software components
// @Description Returns AppOS-local software inventory derived from the local catalog and runtime checks.
// @Tags Software
// @Security BearerAuth
// @Success 200 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/software/local [get]
func handleLocalSoftwareComponentList(e *core.RequestEvent) error {
	items, err := swservice.New(e.App, asynqClient).ListLocalComponents(e.Request.Context())
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "catalog_load_failed",
			"message": err.Error(),
		})
	}
	resp := make([]softwareComponentListItem, 0, len(items))
	for _, item := range items {
		resp = append(resp, softwareComponentListItem{
			SoftwareComponentSummary: item.Summary,
			TargetType:               item.Entry.TargetType,
			Preflight:                item.Detail.Preflight,
			LastOperation:            item.LastOperation,
		})
	}
	return e.JSON(http.StatusOK, map[string]any{
		"target_id": swservice.LocalTargetID,
		"items":     resp,
	})
}

// @Summary Get one AppOS-local software component
// @Description Returns local catalog metadata and current detected state for one AppOS-local component.
// @Tags Software
// @Security BearerAuth
// @Param componentKey path string true "Component key"
// @Success 200 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/software/local/{componentKey} [get]
func handleLocalSoftwareComponentGet(e *core.RequestEvent) error {
	componentKey := software.ComponentKey(e.Request.PathValue("componentKey"))
	item, err := swservice.New(e.App, asynqClient).GetLocalComponent(e.Request.Context(), componentKey)
	if err != nil {
		status := http.StatusInternalServerError
		errorCode := "catalog_load_failed"
		if strings.Contains(err.Error(), "not found in local catalog") {
			status = http.StatusNotFound
			errorCode = "component_not_found"
		}
		return e.JSON(status, map[string]any{
			"error":   errorCode,
			"message": err.Error(),
		})
	}
	return e.JSON(http.StatusOK, softwareComponentDetailResponse{
		SoftwareComponentDetail: item.Detail,
		TargetType:              item.Entry.TargetType,
		LastOperation:           item.LastOperation,
	})
}
