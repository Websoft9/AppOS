package routes

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/domain/software"
	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
	swinventory "github.com/websoft9/appos/backend/domain/software/inventory"
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
	sw.DELETE("/operations/{operationId}", handleSoftwareOperationDelete)
	sw.GET("/operations", handleSoftwareOperationList)
	sw.GET("", handleSoftwareComponentList)
	sw.GET("/{componentKey}", handleSoftwareComponentGet)
	sw.POST("/{componentKey}/{action}", handleSoftwareComponentAction)
}

// registerLocalSoftwareRoutes mounts the AppOS-local software inventory routes under
// /api/software/local.
func registerLocalSoftwareRoutes(api *router.RouterGroup[*core.RequestEvent]) {
	api.GET("/server-catalog", handleSupportedServerCatalogList)
	api.GET("/server-catalog/{componentKey}", handleSupportedServerCatalogGet)

	local := api.Group("/local")
	local.GET("", handleLocalSoftwareComponentList)
	local.GET("/services", handleLocalSoftwareServiceList)
	local.GET("/services/{name}/logs", handleLocalSoftwareServiceLogs)
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

// @Summary Delete a software delivery operation
// @Description Deletes one terminal software delivery operation history record for a server. In-flight operations cannot be deleted.
// @Tags Software
// @Security BearerAuth
// @Param serverId path string true "Server ID"
// @Param operationId path string true "Operation ID"
// @Success 204
// @Failure 404 {object} map[string]any
// @Failure 409 {object} map[string]any
// @Router /api/servers/{serverId}/software/operations/{operationId} [delete]
func handleSoftwareOperationDelete(e *core.RequestEvent) error {
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
	if record.GetString("terminal_status") == string(software.TerminalStatusNone) {
		return e.JSON(http.StatusConflict, map[string]any{
			"error":   "operation_in_flight",
			"message": "in-flight software operations cannot be deleted",
		})
	}
	if err := e.App.Delete(record); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "delete_failed",
			"message": err.Error(),
		})
	}

	return e.NoContent(http.StatusNoContent)
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
	"install":   software.ActionInstall,
	"upgrade":   software.ActionUpgrade,
	"start":     software.ActionStart,
	"stop":      software.ActionStop,
	"restart":   software.ActionRestart,
	"verify":    software.ActionVerify,
	"reinstall": software.ActionReinstall,
	"uninstall": software.ActionUninstall,
}

// @Summary Invoke a software delivery action
// @Description Enqueues an async software delivery action (install, upgrade, start, stop, restart, verify, reinstall, uninstall) for a component on the given server.
// @Tags Software
// @Security BearerAuth
// @Param serverId path string true "Server ID"
// @Param componentKey path string true "Component key (e.g. docker, monitor-agent)"
// @Param action path string true "Action name: install | upgrade | start | stop | restart | verify | reinstall | uninstall"
// @Success 202 {object} map[string]any
// @Failure 400 {object} map[string]any "invalid action"
// @Failure 503 {object} map[string]any "queue not configured"
// @Router /api/servers/{serverId}/software/{componentKey}/{action} [post]
func handleSoftwareComponentAction(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	componentKey := software.ComponentKey(e.Request.PathValue("componentKey"))
	actionStr := e.Request.PathValue("action")
	var body struct {
		AppOSBaseURL string `json:"apposBaseUrl"`
	}
	if e.Request.ContentLength > 0 {
		if err := e.BindBody(&body); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error":   "invalid_body",
				"message": "request body must be valid JSON",
			})
		}
	}
	apposBaseURL, err := normalizeActionAppOSBaseURL(body.AppOSBaseURL)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error":   "invalid_appos_base_url",
			"message": err.Error(),
		})
	}

	act, ok := validSoftwareActions[actionStr]
	if !ok {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error":   "invalid_action",
			"message": "action must be one of: install, upgrade, start, stop, restart, verify, reinstall, uninstall",
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
		if errors.Is(err, worker.ErrSoftwareComponentNotFound) {
			return e.JSON(http.StatusNotFound, map[string]any{
				"error":   "component_not_found",
				"message": err.Error(),
			})
		}
		if errors.Is(err, worker.ErrSoftwareActionUnsupported) {
			return e.JSON(http.StatusBadRequest, map[string]any{
				"error":   "action_not_supported",
				"message": err.Error(),
			})
		}
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "operation_prepare_failed",
			"message": err.Error(),
		})
	}

	userID, userEmail, _, _ := clientInfo(e)
	if err := worker.EnqueueSoftwareAction(asynqClient, record.Id, serverID, componentKey, act, userID, userEmail, apposBaseURL); err != nil {
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

func normalizeActionAppOSBaseURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("apposBaseUrl must include scheme and host")
	}
	return strings.TrimRight(parsed.String(), "/"), nil
}

func markSoftwareOperationEnqueueFailed(e *core.RequestEvent, record *core.Record, enqueueErr error) {
	record.Set("phase", string(software.OperationPhaseFailed))
	record.Set("terminal_status", string(software.TerminalStatusFailed))
	record.Set("failure_phase", string(software.OperationPhaseAccepted))
	record.Set("failure_code", string(software.FailureCodeEnqueueError))
	record.Set("failure_reason", "enqueue failed: "+enqueueErr.Error())
	if err := e.App.Save(record); err != nil {
		e.App.Logger().Error("save failed software operation after enqueue error", "operation_id", record.Id, "err", err)
	}
}

// ─── Component inventory handlers ─────────────────────────────────────────────

type softwareComponentListItem struct {
	software.SoftwareComponentSummary
	TargetType      software.TargetType                  `json:"target_type"`
	ID              string                               `json:"id,omitempty"`
	Name            string                               `json:"name,omitempty"`
	Criticality     string                               `json:"criticality,omitempty"`
	RuntimeKind     string                               `json:"runtime_kind,omitempty"`
	Role            string                               `json:"role,omitempty"`
	Notes           string                               `json:"notes,omitempty"`
	OwnedCapability string                               `json:"owned_capability,omitempty"`
	Version         string                               `json:"version,omitempty"`
	Available       bool                                 `json:"available"`
	ProbePending    bool                                 `json:"probe_pending,omitempty"`
	UpdatedAt       string                               `json:"updated_at,omitempty"`
	Description     string                               `json:"description,omitempty"`
	Preflight       *software.TargetReadinessResult      `json:"preflight,omitempty"`
	Verification    *software.SoftwareVerificationResult `json:"verification,omitempty"`
	LastOperation   *swservice.OperationSummary          `json:"last_operation,omitempty"`
}

type softwareComponentDetailResponse struct {
	software.SoftwareComponentDetail
	TargetType       software.TargetType         `json:"target_type"`
	ID               string                      `json:"id,omitempty"`
	Name             string                      `json:"name,omitempty"`
	Criticality      string                      `json:"criticality,omitempty"`
	RuntimeKind      string                      `json:"runtime_kind,omitempty"`
	Role             string                      `json:"role,omitempty"`
	Notes            string                      `json:"notes,omitempty"`
	OwnedCapability  string                      `json:"owned_capability,omitempty"`
	Version          string                      `json:"version,omitempty"`
	Available        bool                        `json:"available"`
	InventoryPending bool                        `json:"inventory_pending,omitempty"`
	ProbePending     bool                        `json:"probe_pending,omitempty"`
	UpdatedAt        string                      `json:"updated_at,omitempty"`
	LastOperation    *swservice.OperationSummary `json:"last_operation,omitempty"`
}

type localRuntimeComponentMetadata struct {
	ID              string
	Name            string
	Criticality     string
	RuntimeKind     string
	Role            string
	Notes           string
	OwnedCapability string
	Available       bool
	ProbePending    bool
	UpdatedAt       string
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
			Description:              item.Entry.Description,
			Preflight:                item.Detail.Preflight,
			Verification:             item.Detail.Verification,
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
// @Description Returns AppOS-local built-in component inventory derived from the local runtime registry, with software-catalog metadata attached when available.
// @Tags Software
// @Security BearerAuth
// @Success 200 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/software/local [get]
func handleLocalSoftwareComponentList(e *core.RequestEvent) error {
	resp, err := loadLocalRuntimeComponentItems(e.App)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "catalog_load_failed",
			"message": err.Error(),
		})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"target_id": swservice.LocalTargetID,
		"items":     resp,
	})
}

func loadLocalRuntimeComponentItems(app core.App) ([]softwareComponentListItem, error) {
	registry, err := swcatalog.LoadLocalRegistry()
	if err != nil {
		return nil, err
	}
	computedByKey, inventoryReady, err := loadProjectedLocalSoftwareComponents(app)
	if err != nil {
		return nil, err
	}
	if !inventoryReady {
		warmLocalSoftwareInventorySnapshots(app)
	}
	probeStates := currentLocalComponentProbeStates(registry)
	startLocalComponentProbeRefresh(app, registry)

	resp := make([]softwareComponentListItem, 0, len(registry.EnabledComponents()))
	for _, component := range registry.EnabledComponents() {
		probeState, ok := probeStates[component.ID]
		if !ok {
			probeState = localComponentProbeState{Version: "unknown", Available: false, ProbePending: true}
		}

		listItem := softwareComponentListItem{
			TargetType:      software.TargetTypeLocal,
			ID:              component.ID,
			Name:            component.Name,
			Criticality:     component.Criticality,
			RuntimeKind:     component.RuntimeKind,
			Role:            component.Role,
			Notes:           component.Notes,
			OwnedCapability: component.OwnedCapability,
			Version:         probeState.Version,
			Available:       probeState.Available,
			ProbePending:    probeState.ProbePending,
			UpdatedAt:       swinventory.DetectUpdateTime(component.UpdateProbe),
		}

		if component.SoftwareCatalog != nil {
			if computed, ok := computedByKey[component.SoftwareCatalog.ComponentKey]; ok {
				listItem.SoftwareComponentSummary = computed.Summary
				listItem.TargetType = computed.Entry.TargetType
				listItem.Description = computed.Entry.Description
				listItem.Preflight = computed.Detail.Preflight
				listItem.LastOperation = computed.LastOperation
				if strings.EqualFold(strings.TrimSpace(listItem.Version), "unknown") && strings.TrimSpace(computed.Summary.DetectedVersion) != "" {
					listItem.Version = computed.Summary.DetectedVersion
				}
			} else {
				listItem.ComponentKey = component.SoftwareCatalog.ComponentKey
				listItem.Label = component.SoftwareCatalog.Label
				listItem.ArtifactKind = component.SoftwareCatalog.ArtifactKind
			}
		}
		resp = append(resp, listItem)
	}

	return resp, nil
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
	item, inventoryPending, err := getSnapshotFirstLocalSoftwareComponent(e.App, componentKey)
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
	if inventoryPending {
		warmLocalSoftwareInventorySnapshots(e.App)
	}
	runtimeByKey, err := loadLocalRuntimeComponentMetadata(e.App)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "catalog_load_failed",
			"message": err.Error(),
		})
	}
	runtime := runtimeByKey[item.Entry.ComponentKey]
	return e.JSON(http.StatusOK, softwareComponentDetailResponse{
		SoftwareComponentDetail: item.Detail,
		TargetType:              item.Entry.TargetType,
		ID:                      runtime.ID,
		Name:                    runtime.Name,
		Criticality:             runtime.Criticality,
		RuntimeKind:             runtime.RuntimeKind,
		Role:                    runtime.Role,
		Notes:                   runtime.Notes,
		OwnedCapability:         runtime.OwnedCapability,
		Version:                 item.Detail.DetectedVersion,
		Available:               runtime.Available,
		InventoryPending:        inventoryPending,
		ProbePending:            runtime.ProbePending,
		UpdatedAt:               runtime.UpdatedAt,
		LastOperation:           item.LastOperation,
	})
}

func loadLocalRuntimeComponentMetadata(app core.App) (map[software.ComponentKey]localRuntimeComponentMetadata, error) {
	registry, err := swcatalog.LoadLocalRegistry()
	if err != nil {
		return nil, err
	}
	probeStates := currentLocalComponentProbeStates(registry)
	startLocalComponentProbeRefresh(app, registry)
	result := make(map[software.ComponentKey]localRuntimeComponentMetadata)
	for _, component := range registry.EnabledComponents() {
		if component.SoftwareCatalog == nil {
			continue
		}
		probeState, ok := probeStates[component.ID]
		if !ok {
			probeState = localComponentProbeState{Available: false, ProbePending: true}
		}
		result[component.SoftwareCatalog.ComponentKey] = localRuntimeComponentMetadata{
			ID:              component.ID,
			Name:            component.Name,
			Criticality:     component.Criticality,
			RuntimeKind:     component.RuntimeKind,
			Role:            component.Role,
			Notes:           component.Notes,
			OwnedCapability: component.OwnedCapability,
			Available:       probeState.Available,
			ProbePending:    probeState.ProbePending,
			UpdatedAt:       swinventory.DetectUpdateTime(component.UpdateProbe),
		}
	}
	return result, nil
}

// @Summary List AppOS-local software services
// @Description Returns Monitor-observed runtime state for AppOS-local built-in services.
// @Tags Software
// @Security BearerAuth
// @Success 200 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/software/local/services [get]
func handleLocalSoftwareServiceList(e *core.RequestEvent) error {
	items, err := loadLocalComponentServiceItems()
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "local_service_observation_failed",
			"message": err.Error(),
		})
	}
	return e.JSON(http.StatusOK, items)
}

// @Summary Get AppOS-local software service logs
// @Description Returns service logs for one AppOS-local built-in service.
// @Tags Software
// @Security BearerAuth
// @Param name path string true "service name"
// @Param stream query string false "stdout or stderr"
// @Param tail query integer false "approximate line count"
// @Success 200 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 409 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/software/local/services/{name}/logs [get]
func handleLocalSoftwareServiceLogs(e *core.RequestEvent) error {
	name := e.Request.PathValue("name")
	if strings.TrimSpace(name) == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"error": "missing service name"})
	}
	stream := e.Request.URL.Query().Get("stream")
	tail := 200
	if raw := e.Request.URL.Query().Get("tail"); raw != "" {
		if parsed, parseErr := strconv.Atoi(raw); parseErr == nil && parsed > 0 {
			tail = parsed
		}
	}
	payload, status, err := loadLocalComponentServiceLog(name, stream, tail)
	if err != nil {
		if status == http.StatusNotFound {
			return e.JSON(http.StatusNotFound, map[string]any{"error": "service_not_found", "message": "service not found: " + name})
		}
		return e.JSON(status, map[string]any{"error": "logs_failed", "message": err.Error()})
	}
	if status == http.StatusNotFound {
		return e.JSON(http.StatusNotFound, map[string]any{"error": "service_not_found", "message": "service not found: " + name})
	}
	return e.JSON(http.StatusOK, payload)
}

// @Summary List supported server-target software
// @Description Returns the AppOS-managed server software catalog as a read-only discovery surface.
// @Tags Software
// @Security BearerAuth
// @Success 200 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/software/server-catalog [get]
func handleSupportedServerCatalogList(e *core.RequestEvent) error {
	items, err := swservice.New(e.App, asynqClient).ListSupportedServerCatalog(e.Request.Context())
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "catalog_load_failed",
			"message": err.Error(),
		})
	}
	return e.JSON(http.StatusOK, map[string]any{"items": items})
}

// @Summary Get one supported server-target software entry
// @Description Returns one read-only AppOS-managed server software catalog entry.
// @Tags Software
// @Security BearerAuth
// @Param componentKey path string true "Component key"
// @Success 200 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/software/server-catalog/{componentKey} [get]
func handleSupportedServerCatalogGet(e *core.RequestEvent) error {
	componentKey := software.ComponentKey(e.Request.PathValue("componentKey"))
	item, err := swservice.New(e.App, asynqClient).GetSupportedServerCatalogEntry(e.Request.Context(), componentKey)
	if err != nil {
		status := http.StatusInternalServerError
		errorCode := "catalog_load_failed"
		if strings.Contains(err.Error(), "not found in supported server catalog") {
			status = http.StatusNotFound
			errorCode = "component_not_found"
		}
		return e.JSON(status, map[string]any{
			"error":   errorCode,
			"message": err.Error(),
		})
	}
	return e.JSON(http.StatusOK, item)
}
