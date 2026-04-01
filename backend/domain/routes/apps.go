package routes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/domain/deploy"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
	servers "github.com/websoft9/appos/backend/domain/servers"
)

const appComposeConfigMaxBytes int64 = 2 << 20

type composeProjectStatus struct {
	Name        string `json:"Name"`
	Status      string `json:"Status"`
	ConfigFiles string `json:"ConfigFiles"`
}

type appRuntimeContext struct {
	ProjectDir         string
	Source             string
	ComposeProjectName string
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
// @Description Returns installed app inventory with normalized runtime status. Superuser only.
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

	runtimeByServer := map[string]map[string]string{}
	runtimeErrByServer := map[string]string{}
	for _, record := range records {
		serverID := normalizeAppServerID(record.GetString("server_id"))
		if _, ok := runtimeByServer[serverID]; ok || runtimeErrByServer[serverID] != "" {
			continue
		}
		index, runtimeErr := composeStatusIndex(e.App, serverID)
		if runtimeErr != nil {
			runtimeErrByServer[serverID] = runtimeErr.Error()
			continue
		}
		runtimeByServer[serverID] = index
	}

	result := make([]map[string]any, 0, len(records))
	for _, record := range records {
		serverID := normalizeAppServerID(record.GetString("server_id"))
		result = append(result, appInstanceResponse(e.App, record, runtimeByServer[serverID], runtimeErrByServer[serverID]))
	}

	sort.SliceStable(result, func(i, j int) bool {
		return fmt.Sprint(result[i]["updated"]) > fmt.Sprint(result[j]["updated"])
	})

	return e.JSON(http.StatusOK, result)
}

// @Summary Get app detail
// @Description Returns one installed app with normalized runtime status. Superuser only.
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
	runtimeIndex, runtimeErr := composeStatusIndex(e.App, serverID)
	runtimeReason := ""
	if runtimeErr != nil {
		runtimeReason = runtimeErr.Error()
	}

	return e.JSON(http.StatusOK, appInstanceResponse(e.App, record, runtimeIndex, runtimeReason))
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

	client, err := getDockerClientByServerID(e.App, normalizeAppServerID(record.GetString("server_id")))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}

	tail := 200
	if raw := e.Request.URL.Query().Get("tail"); raw != "" {
		fmt.Sscanf(raw, "%d", &tail)
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
// @Description Returns docker-compose.yml content for one installed app. Supports local and remote servers. Superuser only.
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
// @Description Validates draft docker-compose.yml content for one installed app before saving. Supports local and remote servers. Superuser only.
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
// @Description Overwrites docker-compose.yml for one installed app. Supports local and remote servers. Superuser only.
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
// @Description Restores the latest saved docker-compose rollback point for one installed app. Supports local and remote servers. Superuser only.
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
		normalizeInstalledDeploySource(runtimeContext.Source),
		deploy.AdapterManualCompose,
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

func appInstanceResponse(app core.App, record *core.Record, runtimeIndex map[string]string, runtimeReason string) map[string]any {
	name := record.GetString("name")
	runtimeContext, _ := resolveAppRuntimeContext(app, record)
	currentPipeline, _ := appCurrentPipelineResponse(app, record)
	runtimeStatus := appRuntimeStatus(record)
	if runtimeIndex != nil {
		if live, ok := runtimeIndex[name]; ok && strings.TrimSpace(live) != "" {
			runtimeStatus = normalizeComposeRuntimeStatus(live)
			runtimeReason = ""
		}
	}
	if runtimeStatus == "" {
		runtimeStatus = "unknown"
	}

	result := map[string]any{
		"id":                  record.Id,
		"iac_path":            appInstanceIACPath(record.Id, name),
		"server_id":           normalizeAppServerID(record.GetString("server_id")),
		"name":                name,
		"project_dir":         runtimeContext.ProjectDir,
		"source":              runtimeContext.Source,
		"status":              appInstallStatus(record),
		"runtime_status":      runtimeStatus,
		"lifecycle_state":     record.GetString("lifecycle_state"),
		"health_summary":      record.GetString("health_summary"),
		"publication_summary": record.GetString("publication_summary"),
		"state_reason":        record.GetString("state_reason"),
		"access_username":     record.GetString("access_username"),
		"access_secret_hint":  record.GetString("access_secret_hint"),
		"access_retrieval_method": record.GetString("access_retrieval_method"),
		"access_notes":        record.GetString("access_notes"),
		"last_operation":      record.GetString("last_operation"),
		"current_pipeline":    currentPipeline,
		"created":             record.GetDateTime("created").String(),
		"updated":             record.GetDateTime("updated").String(),
	}
	if strings.TrimSpace(runtimeReason) != "" && runtimeStatus == "unknown" {
		result["runtime_reason"] = runtimeReason
	}
	if value := record.GetDateTime("installed_at"); !value.IsZero() {
		result["installed_at"] = value.String()
	}
	return result
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

func normalizeComposeRuntimeStatus(raw string) string {
	value := strings.ToLower(strings.TrimSpace(raw))
	switch {
	case strings.Contains(value, "running"):
		return "running"
	case strings.Contains(value, "exited"), strings.Contains(value, "stopped"):
		return "stopped"
	case strings.Contains(value, "dead"), strings.Contains(value, "error"):
		return "error"
	default:
		return value
	}
}

func normalizeAppServerID(serverID string) string {
	if strings.TrimSpace(serverID) == "" {
		return "local"
	}
	return serverID
}

func composeStatusIndex(app core.App, serverID string) (map[string]string, error) {
	client, err := getDockerClientByServerID(app, serverID)
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
	context.Source = strings.TrimSpace(operationRecord.GetString("trigger_source"))
	if composeProjectName := strings.TrimSpace(operationRecord.GetString("compose_project_name")); composeProjectName != "" {
		context.ComposeProjectName = composeProjectName
	}
	if context.ProjectDir == "" {
		if spec, ok := operationRecord.Get("spec_json").(map[string]any); ok {
			context.ProjectDir = strings.TrimSpace(fmt.Sprint(spec["project_dir"]))
			if context.Source == "" {
				context.Source = strings.TrimSpace(fmt.Sprint(spec["source"]))
			}
		}
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
	switch strings.TrimSpace(record.GetString("lifecycle_state")) {
	case string(model.AppStateRunningHealthy), string(model.AppStateRunningDegraded):
		return "running"
	case string(model.AppStateStopped), string(model.AppStateRetired):
		return "stopped"
	case string(model.AppStateAttentionRequired):
		return "error"
	default:
		return "unknown"
	}
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
	client, err := getDockerClientByServerID(e.App, serverID)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(e.Request.Context(), 45*time.Second)
	defer cancel()

	tempName := fmt.Sprintf(".appos-validate-%d.yml", time.Now().UnixNano())
	tempPath := filepath.Join(projectDir, tempName)

	if serverID == "local" {
		if err := os.WriteFile(tempPath, []byte(content), 0o644); err != nil {
			return fmt.Errorf("write temp compose file: %w", err)
		}
		defer func() {
			_ = os.Remove(tempPath)
		}()
	} else {
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
	}

	_, err = client.Exec(ctx, "compose", "-f", tempPath, "config", "-q")
	if err != nil {
		return fmt.Errorf("compose validation failed: %w", err)
	}
	return nil
}

func readAppComposeConfig(e *core.RequestEvent, serverID string, projectDir string) (string, error) {
	if serverID == "local" {
		return localDockerClient.ComposeConfigRead(projectDir)
	}

	client, err := openAppSFTPClient(e, serverID)
	if err != nil {
		return "", err
	}
	defer client.Close()

	return client.ReadFile(filepath.Join(projectDir, "docker-compose.yml"), appComposeConfigMaxBytes)
}

func writeAppComposeConfig(e *core.RequestEvent, serverID string, projectDir string, content string) error {
	if serverID == "local" {
		return localDockerClient.ComposeConfigWrite(projectDir, content)
	}

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
	abs := filepath.Join(filesBasePath, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return fmt.Errorf("prepare iac directory: %w", err)
	}
	if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
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

func openAppSFTPClient(e *core.RequestEvent, serverID string) (*servers.SFTPClient, error) {
	cfg, err := resolveServerConfig(e, serverID)
	if err != nil {
		return nil, err
	}
	return servers.NewSFTPClient(e.Request.Context(), cfg)
}

type appConfigRollbackSnapshot struct {
	Content      string `json:"content"`
	SavedAt      string `json:"saved_at"`
	SourceAction string `json:"source_action"`
}

func getAppConfigRollbackSnapshot(record *core.Record) (appConfigRollbackSnapshot, bool) {
	abs := filepath.Join(filesBasePath, filepath.FromSlash(appConfigRollbackPath(record.Id, record.GetString("name"))))
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
	abs := filepath.Join(filesBasePath, filepath.FromSlash(appConfigRollbackPath(record.Id, record.GetString("name"))))
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
	if err := os.WriteFile(abs, data, 0o644); err != nil {
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

func normalizeInstalledDeploySource(source string) string {
	source = strings.TrimSpace(source)
	if source == "" {
		return deploy.SourceManualOps
	}
	return source
}
