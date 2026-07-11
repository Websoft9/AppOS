package routes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/domain/audit"
	appcatalog "github.com/websoft9/appos/backend/domain/catalog"
	"github.com/websoft9/appos/backend/domain/iac"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
	"github.com/websoft9/appos/backend/domain/lifecycle/projection"
	lifecyclesvc "github.com/websoft9/appos/backend/domain/lifecycle/service"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitorstore "github.com/websoft9/appos/backend/domain/monitor/status/store"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	"github.com/websoft9/appos/backend/domain/terminal"
	"github.com/websoft9/appos/backend/infra/collections"
)

const appComposeConfigMaxBytes int64 = 2 << 20

var appConfigBasePath string

func resolvedAppConfigBasePath() string {
	if strings.TrimSpace(appConfigBasePath) != "" {
		return appConfigBasePath
	}
	return iac.WorkspaceBasePath()
}

type composeProjectStatus struct {
	Name        string `json:"Name"`
	Status      string `json:"Status"`
	ConfigFiles string `json:"ConfigFiles"`
}

type appRuntimeContext struct {
	ProjectDir         string
	Channel            string
	Trigger            string
	ExecutionMode      string
	ComposeProjectName string
}

type appRuntimeServerState struct {
	RuntimeIndex     map[string]string
	RuntimeReason    string
	ServerName       string
	ConnectionStatus string
	ConnectionReason string
}

type appServerConnectionState struct {
	Status string
	Reason string
}

func registerAppsRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	a := g.Group("/apps")
	a.Bind(apis.RequireSuperuserAuth())
	a.GET("", handleAppInstanceList)
	a.GET("/{id}", handleAppInstanceDetail)
	a.GET("/{id}/releases", handleAppReleaseList)
	a.GET("/{id}/releases/current", handleAppCurrentReleaseDetail)
	a.GET("/{id}/exposures", handleAppExposureList)
	a.GET("/{id}/exposures/{exposureId}", handleAppExposureDetail)
	a.GET("/{id}/logs", handleAppInstanceLogs)
	a.GET("/{id}/config", handleAppInstanceConfigGet)
	a.PUT("/{id}/access", handleAppInstanceAccessUpdate)
	a.POST("/{id}/config/validate", handleAppInstanceConfigValidate)
	a.POST("/{id}/config/rollback", handleAppInstanceConfigRollback)
	a.POST("/{id}/upgrade", handleAppInstanceUpgrade)
	a.POST("/{id}/redeploy", handleAppInstanceRedeploy)
	a.POST("/{id}/start", handleAppInstanceStart)
	a.POST("/{id}/stop", handleAppInstanceStop)
	a.POST("/{id}/restart", handleAppInstanceRestart)
	a.PUT("/{id}/config", handleAppInstanceConfigWrite)
	a.DELETE("/{id}", handleAppInstanceUninstall)
}

// @Summary List installed apps
// @Description Returns installed app inventory with canonical instance_state and normalized runtime status. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/apps [get]
func handleAppInstanceList(e *core.RequestEvent) error {
	col, err := e.App.FindCollectionByNameOrId("app_instances")
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "app_instances collection not found"})
	}

	records, err := e.App.FindRecordsByFilter(col, `lifecycle_state != "retired"`, "-updated", 200, 0)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to list apps"})
	}

	runtimeByServer := map[string]appRuntimeServerState{}
	catalogIconByKey := appCatalogIconIndex()
	for _, record := range records {
		serverID := normalizeAppServerID(record.GetString("server_id"))
		if _, ok := runtimeByServer[serverID]; ok {
			continue
		}
		runtimeByServer[serverID] = resolveAppRuntimeServerState(e.App, serverID)
	}

	result := make([]map[string]any, 0, len(records))
	for _, record := range records {
		serverID := normalizeAppServerID(record.GetString("server_id"))
		serverState := runtimeByServer[serverID]
		result = append(result, appInstanceResponse(e.App, record, serverState, catalogIconByKey))
	}

	sort.SliceStable(result, func(i, j int) bool {
		return fmt.Sprint(result[i]["updated"]) > fmt.Sprint(result[j]["updated"])
	})

	return e.JSON(http.StatusOK, result)
}

// @Summary Get app detail
// @Description Returns one installed app with canonical instance_state and normalized runtime status. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Param id path string true "app instance ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/apps/{id} [get]
func handleAppInstanceDetail(e *core.RequestEvent) error {
	record, err := findAppInstance(e, e.Request.PathValue("id"))
	if err != nil {
		return err
	}

	serverID := normalizeAppServerID(record.GetString("server_id"))
	serverState := resolveAppRuntimeServerState(e.App, serverID)

	return e.JSON(http.StatusOK, appInstanceResponse(e.App, record, serverState, appCatalogIconIndex()))
}

// @Summary Get app logs
// @Description Returns docker compose logs for one installed app. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Param id path string true "app instance ID"
// @Param tail query integer false "number of log lines (default 200)"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/apps/{id}/logs [get]
func handleAppInstanceLogs(e *core.RequestEvent) error {
	record, err := findAppInstance(e, e.Request.PathValue("id"))
	if err != nil {
		return err
	}
	runtimeContext, err := resolveAppRuntimeContext(e.App, record)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}
	if reason, blocked := requireManagedServerRuntimeAccess(e.App, record); blocked {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": reason})
	}

	client, err := servers.NewDockerClient(e.App, normalizeAppServerID(record.GetString("server_id")))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}

	tail := 200
	if raw := e.Request.URL.Query().Get("tail"); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			tail = parsed
		}
	}
	output, err := client.ComposeLogs(e.Request.Context(), runtimeContext.ProjectDir, tail)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "compose logs failed"})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":             record.Id,
		"name":           record.GetString("name"),
		"server_id":      normalizeAppServerID(record.GetString("server_id")),
		"project_dir":    runtimeContext.ProjectDir,
		"runtime_status": appRuntimeStatus(record),
		"output":         output,
	})
}

// @Summary Get app compose config
// @Description Returns docker-compose.yml content for one installed app on a managed server. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Param id path string true "app instance ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/apps/{id}/config [get]
func handleAppInstanceConfigGet(e *core.RequestEvent) error {
	record, err := findAppInstance(e, e.Request.PathValue("id"))
	if err != nil {
		return err
	}
	runtimeContext, err := resolveAppRuntimeContext(e.App, record)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}

	serverID := normalizeAppServerID(record.GetString("server_id"))
	if serverID == "" || serverID == "local" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "managed server is required for app compose config"})
	}
	if reason, blocked := requireManagedServerRuntimeAccess(e.App, record); blocked {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": reason})
	}
	content, err := readAppComposeConfig(e, serverID, runtimeContext.ProjectDir)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":                 record.Id,
		"iac_path":           appInstanceIACPath(record.Id, record.GetString("name")),
		"server_id":          serverID,
		"project_dir":        runtimeContext.ProjectDir,
		"content":            content,
		"rollback_available": false,
	})
}

// @Summary Update app access account hints
// @Description Updates operator-maintained access hints for one installed app. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Param id path string true "app instance ID"
// @Param body body object true "access hints"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/apps/{id}/access [put]
func handleAppInstanceAccessUpdate(e *core.RequestEvent) error {
	record, err := findAppInstance(e, e.Request.PathValue("id"))
	if err != nil {
		return err
	}
	body, err := readBody(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "invalid request body"})
	}
	record.Set("access_username", strings.TrimSpace(bodyString(body, "access_username")))
	record.Set("access_secret_hint", strings.TrimSpace(bodyString(body, "access_secret_hint")))
	record.Set("access_retrieval_method", strings.TrimSpace(bodyString(body, "access_retrieval_method")))
	record.Set("access_notes", strings.TrimSpace(bodyString(body, "access_notes")))
	if err := e.App.Save(record); err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to update access hints"})
	}
	return e.JSON(http.StatusOK, map[string]any{
		"id":                      record.Id,
		"access_username":         record.GetString("access_username"),
		"access_secret_hint":      record.GetString("access_secret_hint"),
		"access_retrieval_method": record.GetString("access_retrieval_method"),
		"access_notes":            record.GetString("access_notes"),
	})
}

// @Summary Validate app compose config
// @Description Validates draft docker-compose.yml content for one installed app on a managed server before saving. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Param id path string true "app instance ID"
// @Param body body object true "content"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/apps/{id}/config/validate [post]
func handleAppInstanceConfigValidate(e *core.RequestEvent) error {
	record, err := findAppInstance(e, e.Request.PathValue("id"))
	if err != nil {
		return err
	}
	runtimeContext, err := resolveAppRuntimeContext(e.App, record)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}

	body, err := readBody(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "invalid request body"})
	}
	content := bodyString(body, "content")
	if strings.TrimSpace(content) == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "content is required"})
	}

	serverID := normalizeAppServerID(record.GetString("server_id"))
	if serverID == "" || serverID == "local" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "managed server is required for app compose config"})
	}
	if reason, blocked := requireManagedServerRuntimeAccess(e.App, record); blocked {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": reason})
	}
	if err := validateAppComposeConfig(e, serverID, runtimeContext.ProjectDir, content); err != nil {
		return e.JSON(http.StatusOK, withMapFields(map[string]any{
			"id":       record.Id,
			"valid":    false,
			"message":  err.Error(),
			"iac_path": appInstanceIACPath(record.Id, record.GetString("name")),
		}, appConfigRollbackResponseFields(record)))
	}
	return e.JSON(http.StatusOK, map[string]any{
		"id":       record.Id,
		"valid":    true,
		"message":  "compose config is valid",
		"iac_path": appInstanceIACPath(record.Id, record.GetString("name")),
	})
}

// @Summary Write app compose config
// @Description Overwrites docker-compose.yml for one installed app on a managed server. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Param id path string true "app instance ID"
// @Param body body object true "content"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/apps/{id}/config [put]
func handleAppInstanceConfigWrite(e *core.RequestEvent) error {
	record, err := findAppInstance(e, e.Request.PathValue("id"))
	if err != nil {
		return err
	}
	runtimeContext, err := resolveAppRuntimeContext(e.App, record)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}

	body, err := readBody(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "invalid request body"})
	}
	content := bodyString(body, "content")
	if strings.TrimSpace(content) == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "content is required"})
	}

	serverID := normalizeAppServerID(record.GetString("server_id"))
	if serverID == "" || serverID == "local" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "managed server is required for app compose config"})
	}
	if reason, blocked := requireManagedServerRuntimeAccess(e.App, record); blocked {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": reason})
	}
	if err := validateAppComposeConfig(e, serverID, runtimeContext.ProjectDir, content); err != nil {
		writeAppAudit(e, record, "app.config.validate", audit.StatusFailed, map[string]any{"errorMessage": err.Error()})
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}
	currentContent, err := readAppComposeConfig(e, serverID, runtimeContext.ProjectDir)
	if err != nil {
		writeAppAudit(e, record, "app.config.write", audit.StatusFailed, map[string]any{"errorMessage": err.Error()})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}
	if err := writeAppComposeConfig(e, serverID, runtimeContext.ProjectDir, content); err != nil {
		writeAppAudit(e, record, "app.config.write", audit.StatusFailed, map[string]any{"errorMessage": err.Error()})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}
	if err := saveAppComposeToIAC(record.Id, record.GetString("name"), content); err != nil {
		writeAppAudit(e, record, "app.config.write", audit.StatusFailed, map[string]any{"errorMessage": err.Error()})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}

	record.Set("updated", time.Now())
	if currentContent != content {
		if err := setAppConfigRollbackSnapshot(record, currentContent, "config.write"); err != nil {
			writeAppAudit(e, record, "app.config.write", audit.StatusFailed, map[string]any{"errorMessage": err.Error()})
			return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
		}
	}
	if saveErr := e.App.Save(record); saveErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to update app instance"})
	}
	writeAppAudit(e, record, "app.config.write", audit.StatusSuccess, nil)

	return e.JSON(http.StatusOK, withMapFields(map[string]any{
		"id":          record.Id,
		"iac_path":    appInstanceIACPath(record.Id, record.GetString("name")),
		"server_id":   serverID,
		"project_dir": runtimeContext.ProjectDir,
		"message":     "saved",
	}, appConfigRollbackResponseFields(record)))
}

// @Summary Roll back app compose config
// @Description Restores the latest saved docker-compose rollback point for one installed app on a managed server. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Param id path string true "app instance ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/apps/{id}/config/rollback [post]
func handleAppInstanceConfigRollback(e *core.RequestEvent) error {
	record, err := findAppInstance(e, e.Request.PathValue("id"))
	if err != nil {
		return err
	}
	runtimeContext, err := resolveAppRuntimeContext(e.App, record)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}

	snapshot, ok := getAppConfigRollbackSnapshot(record)
	if !ok {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "no rollback point available"})
	}

	serverID := normalizeAppServerID(record.GetString("server_id"))
	if serverID == "" || serverID == "local" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "managed server is required for app compose config"})
	}
	if reason, blocked := requireManagedServerRuntimeAccess(e.App, record); blocked {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": reason})
	}
	currentContent, err := readAppComposeConfig(e, serverID, runtimeContext.ProjectDir)
	if err != nil {
		writeAppAudit(e, record, "app.config.rollback", audit.StatusFailed, map[string]any{"errorMessage": err.Error()})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}
	if err := writeAppComposeConfig(e, serverID, runtimeContext.ProjectDir, snapshot.Content); err != nil {
		writeAppAudit(e, record, "app.config.rollback", audit.StatusFailed, map[string]any{"errorMessage": err.Error()})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}
	if err := saveAppComposeToIAC(record.Id, record.GetString("name"), snapshot.Content); err != nil {
		writeAppAudit(e, record, "app.config.rollback", audit.StatusFailed, map[string]any{"errorMessage": err.Error()})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}

	record.Set("updated", time.Now())
	if err := setAppConfigRollbackSnapshot(record, currentContent, "config.rollback"); err != nil {
		writeAppAudit(e, record, "app.config.rollback", audit.StatusFailed, map[string]any{"errorMessage": err.Error()})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}
	if saveErr := e.App.Save(record); saveErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to update app instance"})
	}
	writeAppAudit(e, record, "app.config.rollback", audit.StatusSuccess, map[string]any{"restored_from": snapshot.SavedAt})

	return e.JSON(http.StatusOK, withMapFields(map[string]any{
		"id":          record.Id,
		"iac_path":    appInstanceIACPath(record.Id, record.GetString("name")),
		"server_id":   serverID,
		"project_dir": runtimeContext.ProjectDir,
		"content":     snapshot.Content,
		"message":     "rollback restored",
	}, appConfigRollbackResponseFields(record)))
}

// @Summary Upgrade app
// @Description Creates an upgrade operation using the currently installed compose config and existing project directory. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Param id path string true "app instance ID"
// @Success 202 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/apps/{id}/upgrade [post]
func handleAppInstanceUpgrade(e *core.RequestEvent) error {
	return handleAppInstanceLifecycleOperation(e, string(model.OperationTypeUpgrade))
}

// @Summary Redeploy app
// @Description Creates a redeploy operation using the currently installed compose config and existing project directory. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Param id path string true "app instance ID"
// @Success 202 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/apps/{id}/redeploy [post]
func handleAppInstanceRedeploy(e *core.RequestEvent) error {
	return handleAppInstanceLifecycleOperation(e, string(model.OperationTypeRedeploy))
}

func handleAppInstanceLifecycleOperation(e *core.RequestEvent, action string) error {
	return handleAppInstanceLifecycleOperationWithMetadata(e, action, nil)
}

func handleAppInstanceLifecycleOperationWithMetadata(e *core.RequestEvent, action string, operationMetadata map[string]any) error {
	record, err := findAppInstance(e, e.Request.PathValue("id"))
	if err != nil {
		return err
	}
	runtimeContext, err := resolveAppRuntimeContext(e.App, record)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}

	serverID := normalizeAppServerID(record.GetString("server_id"))
	if reason, blocked := requireManagedServerRuntimeAccess(e.App, record); blocked {
		writeAppAudit(e, record, "app."+action+".create", audit.StatusFailed, map[string]any{"errorMessage": reason, "requestedAction": action})
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": reason})
	}
	content, err := readAppComposeConfig(e, serverID, runtimeContext.ProjectDir)
	if err != nil {
		writeAppAudit(e, record, "app."+action+".create", audit.StatusFailed, map[string]any{"errorMessage": err.Error(), "requestedAction": action})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}

	result, err := createOperationFromCompose(
		e,
		serverID,
		record.GetString("name"),
		content,
		runtimeContext.Channel,
		string(model.TriggerManual),
		string(model.ExecutionModeCompose),
		map[string]any{
			"installed_app_id": record.Id,
			"requested_action": action,
			"project_dir":      runtimeContext.ProjectDir,
		},
		operationCreateOptions{
			ExistingAppID:      record.Id,
			OperationType:      action,
			ProjectDir:         runtimeContext.ProjectDir,
			ComposeProjectName: record.GetString("name"),
			Metadata:           operationMetadata,
		},
	)
	if err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "compose") {
			status = http.StatusBadRequest
		}
		writeAppAudit(e, record, "app."+action+".create", audit.StatusFailed, map[string]any{"errorMessage": err.Error(), "requestedAction": action})
		return e.JSON(status, map[string]any{"code": status, "message": err.Error()})
	}

	writeAppAudit(e, record, "app."+action+".create", audit.StatusPending, map[string]any{"requestedAction": action, "operationId": result["id"]})
	return e.JSON(http.StatusAccepted, result)
}

// @Summary Start app
// @Description Creates a shared lifecycle start operation for an installed app. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Param id path string true "app instance ID"
// @Success 202 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/apps/{id}/start [post]
func handleAppInstanceStart(e *core.RequestEvent) error {
	return handleAppInstanceLifecycleOperation(e, string(model.OperationTypeStart))
}

// @Summary Stop app
// @Description Creates a shared lifecycle stop operation for an installed app. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Param id path string true "app instance ID"
// @Success 202 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/apps/{id}/stop [post]
func handleAppInstanceStop(e *core.RequestEvent) error {
	return handleAppInstanceLifecycleOperation(e, string(model.OperationTypeStop))
}

// @Summary Restart app
// @Description Creates a shared lifecycle restart operation for an installed app. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Param id path string true "app instance ID"
// @Success 202 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/apps/{id}/restart [post]
func handleAppInstanceRestart(e *core.RequestEvent) error {
	return handleAppInstanceLifecycleOperation(e, string(model.OperationTypeRestart))
}

// @Summary Uninstall app
// @Description Creates a shared lifecycle uninstall operation for an installed app. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Param id path string true "app instance ID"
// @Param removeVolumes query boolean false "remove named volumes"
// @Success 202 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/apps/{id} [delete]
func handleAppInstanceUninstall(e *core.RequestEvent) error {
	removeVolumes := e.Request.URL.Query().Get("removeVolumes") == "1" || strings.EqualFold(e.Request.URL.Query().Get("removeVolumes"), "true")
	return handleAppInstanceLifecycleOperationWithMetadata(e, string(model.OperationTypeUninstall), map[string]any{"remove_volumes": removeVolumes})
}

func findAppInstance(e *core.RequestEvent, id string) (*core.Record, error) {
	if id == "" {
		return nil, e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "id is required"})
	}
	record, err := e.App.FindRecordById("app_instances", id)
	if err != nil {
		return nil, e.JSON(http.StatusNotFound, map[string]any{"code": 404, "message": "app instance not found"})
	}
	return record, nil
}

func appInstanceResponse(app core.App, record *core.Record, serverState appRuntimeServerState, catalogIconByKey map[string]string) map[string]any {
	name := record.GetString("name")
	serverID := normalizeAppServerID(record.GetString("server_id"))
	runtimeContext, _ := resolveAppRuntimeContext(app, record)
	currentPipeline, _ := appCurrentPipelineResponse(app, record)
	currentProjection := projection.ReadAppInstanceProjection(record)
	runtimeReason := serverState.RuntimeReason
	liveRuntimeStatus := ""
	if serverState.RuntimeIndex != nil {
		if live, ok := serverState.RuntimeIndex[name]; ok && strings.TrimSpace(live) != "" {
			liveRuntimeStatus = live
			runtimeReason = ""
		}
	}
	effective := projection.ResolveEffectiveAppProjectionFromSources(currentProjection, loadAppProjectionSources(app, record, currentPipeline, liveRuntimeStatus, runtimeReason))
	effectiveProjection := effective.Projection
	runtimeStatus := string(effective.RuntimeStatus)
	if runtimeStatus == "" {
		runtimeStatus = "unknown"
	}

	result := map[string]any{
		"id":                       record.Id,
		"iac_path":                 appInstanceIACPath(record.Id, name),
		"server_id":                serverID,
		"server_name":              serverState.ServerName,
		"name":                     name,
		"project_dir":              runtimeContext.ProjectDir,
		"trigger":                  runtimeContext.Trigger,
		"channel":                  runtimeContext.Channel,
		"execution_mode":           runtimeContext.ExecutionMode,
		"server_connection_status": normalizeServerConnectionStatus(serverState.ConnectionStatus),
		"status":                   appInstallStatus(record),
		"instance_state":           string(effective.InstanceState),
		"runtime_status":           runtimeStatus,
		"health_summary":           string(effectiveProjection.HealthSummary),
		"publication_summary":      string(effectiveProjection.PublicationSummary),
		"state_reason":             effectiveProjection.StateReason,
		"access_username":          record.GetString("access_username"),
		"access_secret_hint":       record.GetString("access_secret_hint"),
		"access_retrieval_method":  record.GetString("access_retrieval_method"),
		"access_notes":             record.GetString("access_notes"),
		"access_endpoints":         appAccessEndpoints(app, record),
		"last_operation":           record.GetString("last_operation"),
		"current_pipeline":         currentPipeline,
		"created":                  record.GetDateTime("created").String(),
		"updated":                  record.GetDateTime("updated").String(),
	}
	if catalogAppKey := appInstanceCatalogAppKey(app, record); catalogAppKey != "" {
		result["catalog_app_key"] = catalogAppKey
		if iconURL := strings.TrimSpace(catalogIconByKey[catalogAppKey]); iconURL != "" {
			result["template_icon_url"] = iconURL
		}
	}
	if strings.TrimSpace(runtimeReason) != "" {
		result["runtime_reason"] = runtimeReason
	}
	if strings.TrimSpace(serverState.ConnectionReason) != "" {
		result["server_connection_reason"] = serverState.ConnectionReason
	}
	if value := record.GetDateTime("installed_at"); !value.IsZero() {
		result["installed_at"] = value.String()
	}
	return result
}

func appAccessEndpoints(app core.App, record *core.Record) any {
	if record == nil {
		return []any{}
	}
	if endpoints := decodeAccessEndpointItems(record.Get("access_endpoints")); len(endpoints) > 0 {
		return endpoints
	}
	if endpoints := appAccessEndpointsFromLatestOperation(app, record.Id); endpoints != nil {
		return endpoints
	}
	return []any{}
}

func appAccessEndpointsFromLatestOperation(app core.App, appID string) []map[string]any {
	if app == nil || strings.TrimSpace(appID) == "" {
		return nil
	}
	records, err := app.FindRecordsByFilter("app_operations", "app = {:appID}", "-updated", 1, 0, map[string]any{"appID": appID})
	if err != nil || len(records) == 0 {
		return nil
	}
	operation := records[0]
	spec := decodeMapValue(operation.Get("spec_json"))
	metadata := decodeMapValue(spec["metadata"])
	exposureIntent := lifecyclesvc.ParseExposureIntentMap(decodeMapValue(spec["exposure_intent"]))
	return lifecyclesvc.ResolveAccessEndpointsFromArtifacts(metadata, operation.GetString("rendered_compose"), exposureIntent)
}

func decodeAccessEndpointItems(raw any) []map[string]any {
	data, err := json.Marshal(raw)
	if err != nil || len(data) == 0 || string(data) == "null" {
		return nil
	}
	var items []map[string]any
	if err := json.Unmarshal(data, &items); err != nil {
		return nil
	}
	return items
}

func decodeMapValue(raw any) map[string]any {
	data, err := json.Marshal(raw)
	if err != nil || len(data) == 0 || string(data) == "null" {
		return nil
	}
	var result map[string]any
	if err := json.Unmarshal(data, &result); err != nil {
		return nil
	}
	return result
}

func appServerName(app core.App, serverID string) string {
	if strings.TrimSpace(serverID) == "local" {
		return "Local"
	}
	if strings.TrimSpace(serverID) == "" {
		return "Unavailable"
	}
	server, err := app.FindRecordById("servers", serverID)
	if err != nil {
		return serverID
	}
	if name := strings.TrimSpace(server.GetString("name")); name != "" {
		return name
	}
	return serverID
}

func resolveAppRuntimeServerState(app core.App, serverID string) appRuntimeServerState {
	state := appRuntimeServerState{ServerName: appServerName(app, serverID)}
	trimmedServerID := strings.TrimSpace(serverID)
	if trimmedServerID == "" {
		state.RuntimeReason = "app server is not assigned"
		state.ConnectionStatus = "unknown"
		state.ConnectionReason = "App server is not assigned."
		return state
	}
	if trimmedServerID == "local" {
		state.ConnectionStatus = "online"
		return state
	}

	serverRecord, err := app.FindRecordById("servers", trimmedServerID)
	if err != nil {
		state.RuntimeReason = "managed server record is unavailable"
		state.ConnectionStatus = "unknown"
		state.ConnectionReason = "Managed server record is unavailable."
		return state
	}
	if serverName := strings.TrimSpace(serverRecord.GetString("name")); serverName != "" {
		state.ServerName = serverName
	}
	connection := resolveAppServerConnectionState(app, serverRecord)
	state.ConnectionStatus = normalizeServerConnectionStatus(connection.Status)
	state.ConnectionReason = connection.Reason
	if strings.TrimSpace(connection.Reason) != "" {
		state.RuntimeReason = connection.Reason
		return state
	}

	runtimeIndex, runtimeErr := composeStatusIndex(app, trimmedServerID)
	if runtimeErr != nil {
		state.RuntimeReason = runtimeErr.Error()
		return state
	}
	state.RuntimeIndex = runtimeIndex
	return state
}

func requireManagedServerRuntimeAccess(app core.App, record *core.Record) (string, bool) {
	if app == nil || record == nil {
		return "app instance is unavailable", true
	}
	serverID := normalizeAppServerID(record.GetString("server_id"))
	if serverID == "" || serverID == "local" {
		return "", false
	}
	serverRecord, err := app.FindRecordById("servers", serverID)
	if err != nil {
		return "Managed server record is unavailable.", true
	}
	connection := resolveAppServerConnectionState(app, serverRecord)
	if normalizeServerConnectionStatus(connection.Status) == "online" {
		return "", false
	}
	if strings.TrimSpace(connection.Reason) != "" {
		return connection.Reason, true
	}
	return "Server runtime status is unavailable.", true
}

func resolveAppServerConnectionState(app core.App, serverRecord *core.Record) appServerConnectionState {
	if serverRecord == nil {
		return appServerConnectionState{Status: "unknown", Reason: "Managed server record is unavailable."}
	}
	connectType := strings.ToLower(strings.TrimSpace(serverRecord.GetString("connect_type")))
	if connectType == "tunnel" {
		tunnelStatus := strings.ToLower(strings.TrimSpace(serverRecord.GetString("tunnel_status")))
		if tunnelStatus != "" && tunnelStatus != string(servers.TunnelStatusOnline) {
			return appServerConnectionState{
				Status: "tunnel_disconnected",
				Reason: describeAppRuntimeFallbackReason(tunnelStatus, strings.TrimSpace(serverRecord.GetString("tunnel_disconnect_reason"))),
			}
		}
	}

	accessStatus := strings.ToLower(strings.TrimSpace(serverRecord.GetString("access_status")))
	if accessStatus == "unavailable" {
		return appServerConnectionState{
			Status: "unreachable",
			Reason: describeAppRuntimeFallbackReason(accessStatus, strings.TrimSpace(serverRecord.GetString("access_reason"))),
		}
	}

	monitorRecord, err := app.FindFirstRecordByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": monitor.TargetTypeServer, "targetID": serverRecord.Id},
	)
	if err != nil {
		return appServerConnectionState{Status: "online"}
	}
	monitorStatus := strings.TrimSpace(monitorRecord.GetString("status"))
	switch monitorStatus {
	case monitor.StatusOffline, monitor.StatusUnreachable, monitor.StatusCredentialInvalid:
		return appServerConnectionState{
			Status: normalizeServerConnectionStatus(monitorStatus),
			Reason: describeAppRuntimeFallbackReason(monitorStatus, strings.TrimSpace(monitorRecord.GetString("reason"))),
		}
	default:
		return appServerConnectionState{Status: "online"}
	}
}

func normalizeServerConnectionStatus(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "", "online", "healthy", "available":
		return "online"
	case monitor.StatusOffline:
		return "offline"
	case monitor.StatusCredentialInvalid:
		return "credential_invalid"
	case "tunnel_disconnected":
		return "tunnel_disconnected"
	case "unknown":
		return "unknown"
	default:
		return "unreachable"
	}
}

func describeAppRuntimeFallbackReason(status string, reason string) string {
	normalizedStatus := strings.ToLower(strings.TrimSpace(status))
	normalizedReason := strings.ToLower(strings.TrimSpace(reason))
	switch normalizedReason {
	case "control_unreachable":
		return "Server is unreachable from the control plane."
	case "credential_auth_failed":
		return "Server credentials are invalid."
	case "tcp_connect_failed":
		return "Server TCP connectivity failed."
	}
	switch normalizedStatus {
	case monitor.StatusOffline:
		return "Server is offline."
	case monitor.StatusUnreachable, "unavailable":
		return "Server is unreachable."
	case monitor.StatusCredentialInvalid:
		return "Server credentials are invalid."
	}
	if strings.TrimSpace(reason) != "" {
		return strings.TrimSpace(reason)
	}
	if strings.TrimSpace(status) != "" {
		return strings.TrimSpace(status)
	}
	return "Server runtime status is unavailable."
}

func appCatalogIconIndex() map[string]string {
	bundle, err := appcatalog.LoadBundle("en")
	if err != nil || bundle == nil {
		return map[string]string{}
	}
	result := make(map[string]string, len(bundle.Products))
	for _, product := range bundle.Products {
		key := strings.TrimSpace(product.Key)
		iconURL := strings.TrimSpace(product.Logo.ImageURL)
		if key == "" || iconURL == "" {
			continue
		}
		result[key] = iconURL
	}
	return result
}

func appInstanceCatalogAppKey(app core.App, record *core.Record) string {
	if record == nil {
		return ""
	}
	if templateKey := strings.TrimSpace(record.GetString("template_key")); templateKey != "" {
		return templateKey
	}
	operationID := strings.TrimSpace(record.GetString("last_operation"))
	if operationID == "" {
		return ""
	}
	operationRecord, err := app.FindRecordById("app_operations", operationID)
	if err != nil {
		return ""
	}
	spec, ok := operationSpecMap(operationRecord.Get("spec_json"))
	if !ok {
		return ""
	}
	metadata, ok := operationSpecMap(spec["metadata"])
	if !ok {
		return ""
	}
	prefillContext, ok := operationSpecMap(metadata["prefill_context"])
	if !ok {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(prefillContext["app_key"]))
}

func operationSpecMap(value any) (map[string]any, bool) {
	switch typed := value.(type) {
	case map[string]any:
		return typed, true
	case string:
		return decodeOperationSpecJSON([]byte(typed))
	case []byte:
		return decodeOperationSpecJSON(typed)
	default:
		raw, err := json.Marshal(value)
		if err != nil {
			return nil, false
		}
		return decodeOperationSpecJSON(raw)
	}
}

func decodeOperationSpecJSON(raw []byte) (map[string]any, bool) {
	if len(raw) == 0 {
		return nil, false
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, false
	}
	return parsed, true
}

func appCurrentPipelineResponse(app core.App, record *core.Record) (map[string]any, error) {
	if record == nil {
		return nil, nil
	}
	operationID := strings.TrimSpace(record.GetString("last_operation"))
	if operationID == "" {
		return nil, nil
	}
	operationRecord, err := app.FindRecordById("app_operations", operationID)
	if err != nil {
		return nil, err
	}
	pipelineRunID := strings.TrimSpace(operationRecord.GetString("pipeline_run"))
	if pipelineRunID == "" {
		return nil, nil
	}
	stepRuns, err := findPipelineNodeRuns(app, pipelineRunID)
	if err != nil {
		return nil, err
	}
	return buildPipelineResponse(app, pipelineRunID, operationRecord, stepRuns)
}

func normalizeAppServerID(serverID string) string {
	return strings.TrimSpace(serverID)
}

func composeStatusIndex(app core.App, serverID string) (map[string]string, error) {
	client, err := servers.NewDockerClient(app, serverID)
	if err != nil {
		return nil, err
	}
	output, err := client.ComposeLs(context.Background())
	if err != nil {
		return nil, err
	}

	var projects []composeProjectStatus
	if strings.TrimSpace(output) == "" {
		return map[string]string{}, nil
	}
	if err := json.Unmarshal([]byte(output), &projects); err != nil {
		var single composeProjectStatus
		if singleErr := json.Unmarshal([]byte(output), &single); singleErr == nil && single.Name != "" {
			projects = []composeProjectStatus{single}
		} else {
			return nil, err
		}
	}

	index := make(map[string]string, len(projects))
	for _, project := range projects {
		index[project.Name] = project.Status
	}
	return index, nil
}

func resolveAppRuntimeContext(app core.App, record *core.Record) (appRuntimeContext, error) {
	context := appRuntimeContext{ComposeProjectName: record.GetString("name")}
	if record == nil {
		return context, fmt.Errorf("app instance is nil")
	}
	operationID := strings.TrimSpace(record.GetString("last_operation"))
	if operationID == "" {
		return context, fmt.Errorf("app runtime context is missing last_operation")
	}
	operationRecord, err := app.FindRecordById("app_operations", operationID)
	if err != nil {
		return context, fmt.Errorf("app runtime context operation not found")
	}
	context.ProjectDir = strings.TrimSpace(operationRecord.GetString("project_dir"))
	context.Trigger = model.NormalizeOperationTrigger(operationRecord.GetString("trigger"))
	context.Channel = model.NormalizeOperationChannel(record.GetString("channel"))
	context.ExecutionMode = model.NormalizeOperationExecutionMode(operationRecord.GetString("execution_mode"))
	if context.Channel == "" && strings.TrimSpace(record.GetString("template_key")) != "" {
		context.Channel = string(model.ChannelStore)
	}
	if composeProjectName := strings.TrimSpace(operationRecord.GetString("compose_project_name")); composeProjectName != "" {
		context.ComposeProjectName = composeProjectName
	}
	if context.ProjectDir == "" {
		if spec, ok := operationRecord.Get("spec_json").(map[string]any); ok {
			context.ProjectDir = strings.TrimSpace(fmt.Sprint(spec["project_dir"]))
			if context.Trigger == "" {
				context.Trigger = model.NormalizeOperationTrigger(fmt.Sprint(spec["trigger"]))
			}
			if context.Channel == "" {
				context.Channel = model.NormalizeOperationChannel(fmt.Sprint(spec["channel"]))
			}
			if context.ExecutionMode == "" {
				context.ExecutionMode = model.NormalizeOperationExecutionMode(fmt.Sprint(spec["execution_mode"]))
			}
		}
	}
	if context.Channel == "" {
		context.Channel = string(model.ChannelCustom)
	}
	if context.ExecutionMode == "" {
		context.ExecutionMode = string(model.ExecutionModeCompose)
	}
	if context.ProjectDir == "" {
		return context, fmt.Errorf("app runtime context is missing project_dir")
	}
	return context, nil
}

func appInstallStatus(record *core.Record) string {
	switch strings.TrimSpace(record.GetString("lifecycle_state")) {
	case string(model.AppStateRetired):
		return "uninstalled"
	default:
		return "installed"
	}
}

func appRuntimeStatus(record *core.Record) string {
	return string(projection.RuntimeStatusFromProjection(projection.ReadAppInstanceProjection(record)))
}

func loadAppProjectionSources(app core.App, record *core.Record, currentPipeline map[string]any, liveRuntimeStatus string, runtimeReason string) projection.AppProjectionSources {
	sources := projection.AppProjectionSources{
		CurrentPipeline:   currentPipeline,
		LiveRuntimeStatus: liveRuntimeStatus,
		RuntimeReason:     runtimeReason,
	}
	if app == nil || record == nil {
		return sources
	}
	primaryPublicationState := ""
	primaryHealthState := ""
	if exposureID := strings.TrimSpace(record.GetString("primary_exposure")); exposureID != "" {
		if exposureRecord, err := app.FindRecordById("app_exposures", exposureID); err == nil {
			primaryPublicationState = exposureRecord.GetString("publication_state")
			primaryHealthState = exposureRecord.GetString("health_state")
		}
	}
	sources.PrimaryExposurePublicationState = primaryPublicationState
	sources.PrimaryExposureHealthState = primaryHealthState
	if monitorRecord, err := app.FindFirstRecordByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": monitor.TargetTypeApp, "targetID": record.Id},
	); err == nil {
		sources.MonitorStatus = strings.TrimSpace(monitorRecord.GetString("status"))
		sources.MonitorReason = strings.TrimSpace(monitorRecord.GetString("reason"))
		sources.MonitorSummary = monitorstore.LoadExistingSummary(app, monitor.TargetTypeApp, record.Id)
	} else {
		sources.MonitorSummary = monitorstore.LoadExistingSummary(app, monitor.TargetTypeApp, record.Id)
	}
	return sources
}

func writeAppAudit(e *core.RequestEvent, record *core.Record, action string, status string, detail map[string]any) {
	userID, userEmail, ip, ua := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		UserEmail:    userEmail,
		Action:       action,
		ResourceType: "app",
		ResourceID:   record.Id,
		ResourceName: record.GetString("name"),
		Status:       status,
		IP:           ip,
		UserAgent:    ua,
		Detail:       detail,
	})
}

func validateAppComposeConfig(e *core.RequestEvent, serverID string, projectDir string, content string) error {
	client, err := servers.NewDockerClient(e.App, serverID)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(e.Request.Context(), 45*time.Second)
	defer cancel()

	tempName := fmt.Sprintf(".appos-validate-%d.yml", time.Now().UnixNano())
	tempPath := filepath.Join(projectDir, tempName)

	sftpClient, err := openAppSFTPClient(e, serverID)
	if err != nil {
		return err
	}
	defer sftpClient.Close()
	if err := sftpClient.WriteFile(tempPath, content); err != nil {
		return fmt.Errorf("write remote temp compose file: %w", err)
	}
	defer func() {
		_ = sftpClient.Delete(tempPath)
	}()

	_, err = client.Exec(ctx, "compose", "-f", tempPath, "config", "-q")
	if err != nil {
		return fmt.Errorf("compose validation failed: %w", err)
	}
	return nil
}

func readAppComposeConfig(e *core.RequestEvent, serverID string, projectDir string) (string, error) {
	client, err := openAppSFTPClient(e, serverID)
	if err != nil {
		return "", err
	}
	defer client.Close()

	return client.ReadFile(filepath.Join(projectDir, "docker-compose.yml"), appComposeConfigMaxBytes)
}

func writeAppComposeConfig(e *core.RequestEvent, serverID string, projectDir string, content string) error {
	client, err := openAppSFTPClient(e, serverID)
	if err != nil {
		return err
	}
	defer client.Close()

	return client.WriteFile(filepath.Join(projectDir, "docker-compose.yml"), content)
}

func appInstanceIACPath(id string, name string) string {
	shortID := id
	if len(shortID) > 8 {
		shortID = shortID[:8]
	}
	slug := slugifyAppName(name)
	if slug == "" {
		slug = "app"
	}
	return filepath.ToSlash(filepath.Join("apps", "installed", shortID+"-"+slug, "docker-compose.yml"))
}

func saveAppComposeToIAC(id string, name string, content string) error {
	if strings.TrimSpace(content) == "" {
		return nil
	}
	rel := appInstanceIACPath(id, name)
	abs := filepath.Join(resolvedAppConfigBasePath(), filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return fmt.Errorf("prepare iac directory: %w", err)
	}
	if err := os.WriteFile(abs, []byte(content), 0o600); err != nil {
		return fmt.Errorf("write iac compose file: %w", err)
	}
	return nil
}

func appConfigRollbackPath(id string, name string) string {
	base := filepath.Dir(appInstanceIACPath(id, name))
	return filepath.ToSlash(filepath.Join(base, "rollback.json"))
}

func slugifyAppName(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	if name == "" {
		return ""
	}
	var builder strings.Builder
	lastDash := false
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			builder.WriteRune(r)
			lastDash = false
		case !lastDash:
			builder.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(builder.String(), "-")
}

func openAppSFTPClient(e *core.RequestEvent, serverID string) (*terminal.SFTPClient, error) {
	cfg, err := resolveTerminalConfig(e.App, e.Auth, serverID)
	if err != nil {
		return nil, err
	}
	return terminal.NewSFTPClient(e.Request.Context(), cfg)
}

type appConfigRollbackSnapshot struct {
	Content      string `json:"content"`
	SavedAt      string `json:"saved_at"`
	SourceAction string `json:"source_action"`
}

func getAppConfigRollbackSnapshot(record *core.Record) (appConfigRollbackSnapshot, bool) {
	abs := filepath.Join(resolvedAppConfigBasePath(), filepath.FromSlash(appConfigRollbackPath(record.Id, record.GetString("name"))))
	raw, err := os.ReadFile(abs)
	if err != nil {
		return appConfigRollbackSnapshot{}, false
	}

	snapshot := appConfigRollbackSnapshot{}
	if json.Unmarshal(raw, &snapshot) != nil {
		return appConfigRollbackSnapshot{}, false
	}
	snapshot.SavedAt = strings.TrimSpace(snapshot.SavedAt)
	snapshot.SourceAction = strings.TrimSpace(snapshot.SourceAction)

	if strings.TrimSpace(snapshot.Content) == "" {
		return appConfigRollbackSnapshot{}, false
	}
	return snapshot, true
}

func setAppConfigRollbackSnapshot(record *core.Record, content string, sourceAction string) error {
	abs := filepath.Join(resolvedAppConfigBasePath(), filepath.FromSlash(appConfigRollbackPath(record.Id, record.GetString("name"))))
	if strings.TrimSpace(content) == "" {
		if err := os.Remove(abs); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove rollback snapshot: %w", err)
		}
		return nil
	}
	snapshot := appConfigRollbackSnapshot{
		Content:      content,
		SavedAt:      time.Now().UTC().Format(time.RFC3339),
		SourceAction: strings.TrimSpace(sourceAction),
	}
	data, err := json.Marshal(snapshot)
	if err != nil {
		return fmt.Errorf("marshal rollback snapshot: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return fmt.Errorf("prepare rollback snapshot directory: %w", err)
	}
	if err := os.WriteFile(abs, data, 0o600); err != nil {
		return fmt.Errorf("write rollback snapshot: %w", err)
	}
	return nil
}

func appConfigRollbackResponseFields(record *core.Record) map[string]any {
	snapshot, ok := getAppConfigRollbackSnapshot(record)
	if !ok {
		return map[string]any{"rollback_available": false}
	}
	result := map[string]any{"rollback_available": true}
	if snapshot.SavedAt != "" {
		result["rollback_saved_at"] = snapshot.SavedAt
	}
	if snapshot.SourceAction != "" {
		result["rollback_source_action"] = snapshot.SourceAction
	}
	return result
}

func withMapFields(base map[string]any, extra map[string]any) map[string]any {
	for key, value := range extra {
		base[key] = value
	}
	return base
}
