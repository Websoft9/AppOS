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
	"github.com/websoft9/appos/backend/internal/audit"
	"github.com/websoft9/appos/backend/internal/deploy"
	servers "github.com/websoft9/appos/backend/internal/servers"
)

const appComposeConfigMaxBytes int64 = 2 << 20

type composeProjectStatus struct {
	Name        string `json:"Name"`
	Status      string `json:"Status"`
	ConfigFiles string `json:"ConfigFiles"`
}

func registerAppsRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	a := g.Group("/apps")
	a.Bind(apis.RequireSuperuserAuth())
	a.GET("", handleAppInstanceList)
	a.GET("/{id}", handleAppInstanceDetail)
	a.GET("/{id}/logs", handleAppInstanceLogs)
	a.GET("/{id}/config", handleAppInstanceConfigGet)
	a.POST("/{id}/config/validate", handleAppInstanceConfigValidate)
	a.POST("/{id}/config/rollback", handleAppInstanceConfigRollback)
	a.POST("/{id}/deploy", handleAppInstanceDeploy)
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

	records, err := e.App.FindRecordsByFilter(col, `status != "uninstalled"`, "-updated", 200, 0)
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
		result = append(result, appInstanceResponse(record, runtimeByServer[serverID], runtimeErrByServer[serverID]))
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

	return e.JSON(http.StatusOK, appInstanceResponse(record, runtimeIndex, runtimeReason))
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

	client, err := getDockerClientByServerID(e.App, normalizeAppServerID(record.GetString("server_id")))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}

	tail := 200
	if raw := e.Request.URL.Query().Get("tail"); raw != "" {
		fmt.Sscanf(raw, "%d", &tail)
	}
	output, err := client.ComposeLogs(e.Request.Context(), record.GetString("project_dir"), tail)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "compose logs failed"})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":             record.Id,
		"name":           record.GetString("name"),
		"server_id":      normalizeAppServerID(record.GetString("server_id")),
		"project_dir":    record.GetString("project_dir"),
		"runtime_status": record.GetString("runtime_status"),
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

	serverID := normalizeAppServerID(record.GetString("server_id"))
	content, err := readAppComposeConfig(e, serverID, record.GetString("project_dir"))
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":                 record.Id,
		"iac_path":           appInstanceIACPath(record.Id, record.GetString("name")),
		"server_id":          serverID,
		"project_dir":        record.GetString("project_dir"),
		"content":            content,
		"rollback_available": false,
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

	body, err := readBody(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "invalid request body"})
	}
	content := bodyString(body, "content")
	if strings.TrimSpace(content) == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "content is required"})
	}

	serverID := normalizeAppServerID(record.GetString("server_id"))
	if err := validateAppComposeConfig(e, serverID, record.GetString("project_dir"), content); err != nil {
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

	body, err := readBody(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "invalid request body"})
	}
	content := bodyString(body, "content")
	if strings.TrimSpace(content) == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "content is required"})
	}

	serverID := normalizeAppServerID(record.GetString("server_id"))
	if err := validateAppComposeConfig(e, serverID, record.GetString("project_dir"), content); err != nil {
		writeAppAudit(e, record, "app.config.validate", audit.StatusFailed, map[string]any{"errorMessage": err.Error()})
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}
	currentContent, err := readAppComposeConfig(e, serverID, record.GetString("project_dir"))
	if err != nil {
		writeAppAudit(e, record, "app.config.write", audit.StatusFailed, map[string]any{"errorMessage": err.Error()})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}
	if err := writeAppComposeConfig(e, serverID, record.GetString("project_dir"), content); err != nil {
		writeAppAudit(e, record, "app.config.write", audit.StatusFailed, map[string]any{"errorMessage": err.Error()})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}
	if err := saveAppComposeToIAC(record.Id, record.GetString("name"), content); err != nil {
		writeAppAudit(e, record, "app.config.write", audit.StatusFailed, map[string]any{"errorMessage": err.Error()})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}

	record.Set("updated", time.Now())
	if currentContent != content {
		setAppConfigRollbackSnapshot(record, currentContent, "config.write")
	}
	if saveErr := e.App.Save(record); saveErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to update app instance"})
	}
	writeAppAudit(e, record, "app.config.write", audit.StatusSuccess, nil)

	return e.JSON(http.StatusOK, withMapFields(map[string]any{
		"id":          record.Id,
		"iac_path":    appInstanceIACPath(record.Id, record.GetString("name")),
		"server_id":   serverID,
		"project_dir": record.GetString("project_dir"),
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

	snapshot, ok := getAppConfigRollbackSnapshot(record)
	if !ok {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "no rollback point available"})
	}

	serverID := normalizeAppServerID(record.GetString("server_id"))
	currentContent, err := readAppComposeConfig(e, serverID, record.GetString("project_dir"))
	if err != nil {
		writeAppAudit(e, record, "app.config.rollback", audit.StatusFailed, map[string]any{"errorMessage": err.Error()})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}
	if err := writeAppComposeConfig(e, serverID, record.GetString("project_dir"), snapshot.Content); err != nil {
		writeAppAudit(e, record, "app.config.rollback", audit.StatusFailed, map[string]any{"errorMessage": err.Error()})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}
	if err := saveAppComposeToIAC(record.Id, record.GetString("name"), snapshot.Content); err != nil {
		writeAppAudit(e, record, "app.config.rollback", audit.StatusFailed, map[string]any{"errorMessage": err.Error()})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}

	record.Set("updated", time.Now())
	setAppConfigRollbackSnapshot(record, currentContent, "config.rollback")
	if saveErr := e.App.Save(record); saveErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to update app instance"})
	}
	writeAppAudit(e, record, "app.config.rollback", audit.StatusSuccess, map[string]any{"restored_from": snapshot.SavedAt})

	return e.JSON(http.StatusOK, withMapFields(map[string]any{
		"id":          record.Id,
		"iac_path":    appInstanceIACPath(record.Id, record.GetString("name")),
		"server_id":   serverID,
		"project_dir": record.GetString("project_dir"),
		"content":     snapshot.Content,
		"message":     "rollback restored",
	}, appConfigRollbackResponseFields(record)))
}

// @Summary Create deployment from installed app
// @Description Creates a one-click redeploy or upgrade deployment using the currently installed compose config and existing project directory. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Param id path string true "app instance ID"
// @Param body body object true "action"
// @Success 202 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/apps/{id}/deploy [post]
func handleAppInstanceDeploy(e *core.RequestEvent) error {
	record, err := findAppInstance(e, e.Request.PathValue("id"))
	if err != nil {
		return err
	}

	body, err := readBody(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "invalid request body"})
	}
	action := strings.TrimSpace(strings.ToLower(bodyString(body, "action")))
	if action == "" {
		action = "redeploy"
	}
	if action != "redeploy" && action != "upgrade" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "action must be redeploy or upgrade"})
	}

	serverID := normalizeAppServerID(record.GetString("server_id"))
	content, err := readAppComposeConfig(e, serverID, record.GetString("project_dir"))
	if err != nil {
		writeAppAudit(e, record, "app.deploy.create", audit.StatusFailed, map[string]any{"errorMessage": err.Error(), "requestedAction": action})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": err.Error()})
	}

	result, err := createDeploymentFromCompose(
		e,
		serverID,
		record.GetString("name"),
		content,
		normalizeInstalledDeploySource(record.GetString("source")),
		deploy.AdapterManualCompose,
		map[string]any{
			"installed_app_id": record.Id,
			"requested_action": action,
			"project_dir":      record.GetString("project_dir"),
		},
		deploymentCreateOptions{
			ProjectDir:         record.GetString("project_dir"),
			ComposeProjectName: record.GetString("name"),
		},
	)
	if err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "compose") {
			status = http.StatusBadRequest
		}
		writeAppAudit(e, record, "app.deploy.create", audit.StatusFailed, map[string]any{"errorMessage": err.Error(), "requestedAction": action})
		return e.JSON(status, map[string]any{"code": status, "message": err.Error()})
	}

	writeAppAudit(e, record, "app.deploy.create", audit.StatusPending, map[string]any{"requestedAction": action, "deploymentId": result["id"]})
	return e.JSON(http.StatusAccepted, result)
}

// @Summary Start app
// @Description Starts an installed app via docker compose start. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Param id path string true "app instance ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/apps/{id}/start [post]
func handleAppInstanceStart(e *core.RequestEvent) error {
	return handleAppInstanceAction(e, "start")
}

// @Summary Stop app
// @Description Stops an installed app via docker compose stop. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Param id path string true "app instance ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/apps/{id}/stop [post]
func handleAppInstanceStop(e *core.RequestEvent) error {
	return handleAppInstanceAction(e, "stop")
}

// @Summary Restart app
// @Description Restarts an installed app via docker compose restart. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Param id path string true "app instance ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/apps/{id}/restart [post]
func handleAppInstanceRestart(e *core.RequestEvent) error {
	return handleAppInstanceAction(e, "restart")
}

// @Summary Uninstall app
// @Description Runs docker compose down for an installed app and marks it uninstalled. Superuser only.
// @Tags Apps
// @Security BearerAuth
// @Param id path string true "app instance ID"
// @Param removeVolumes query boolean false "remove named volumes"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/apps/{id} [delete]
func handleAppInstanceUninstall(e *core.RequestEvent) error {
	record, err := findAppInstance(e, e.Request.PathValue("id"))
	if err != nil {
		return err
	}

	client, err := getDockerClientByServerID(e.App, normalizeAppServerID(record.GetString("server_id")))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}

	removeVolumes := e.Request.URL.Query().Get("removeVolumes") == "1" || strings.EqualFold(e.Request.URL.Query().Get("removeVolumes"), "true")
	output, err := client.ComposeDown(e.Request.Context(), record.GetString("project_dir"), removeVolumes)
	if err != nil {
		writeAppAudit(e, record, "app.uninstall", audit.StatusFailed, map[string]any{"errorMessage": err.Error()})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "compose down failed"})
	}

	markAppAction(record, "uninstall", "removed", "")
	record.Set("status", "uninstalled")
	if saveErr := e.App.Save(record); saveErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to update app instance"})
	}
	writeAppAudit(e, record, "app.uninstall", audit.StatusSuccess, nil)

	return e.JSON(http.StatusOK, map[string]any{"id": record.Id, "output": output, "status": "uninstalled"})
}

func handleAppInstanceAction(e *core.RequestEvent, action string) error {
	record, err := findAppInstance(e, e.Request.PathValue("id"))
	if err != nil {
		return err
	}

	client, err := getDockerClientByServerID(e.App, normalizeAppServerID(record.GetString("server_id")))
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": err.Error()})
	}

	var output string
	switch action {
	case "start":
		output, err = client.ComposeStart(e.Request.Context(), record.GetString("project_dir"))
	case "stop":
		output, err = client.ComposeStop(e.Request.Context(), record.GetString("project_dir"))
	case "restart":
		output, err = client.ComposeRestart(e.Request.Context(), record.GetString("project_dir"))
	default:
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "unsupported action"})
	}
	if err != nil {
		writeAppAudit(e, record, "app."+action, audit.StatusFailed, map[string]any{"errorMessage": err.Error()})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "compose " + action + " failed"})
	}

	runtimeStatus := map[string]string{
		"start":   "running",
		"stop":    "stopped",
		"restart": "running",
	}[action]
	markAppAction(record, action, runtimeStatus, "")
	if saveErr := e.App.Save(record); saveErr != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to update app instance"})
	}
	writeAppAudit(e, record, "app."+action, audit.StatusSuccess, nil)

	return e.JSON(http.StatusOK, map[string]any{"id": record.Id, "output": output, "runtime_status": runtimeStatus})
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

func appInstanceResponse(record *core.Record, runtimeIndex map[string]string, runtimeReason string) map[string]any {
	name := record.GetString("name")
	runtimeStatus := strings.TrimSpace(record.GetString("runtime_status"))
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
		"id":                     record.Id,
		"deployment_id":          record.GetString("deployment_id"),
		"iac_path":               appInstanceIACPath(record.Id, name),
		"server_id":              normalizeAppServerID(record.GetString("server_id")),
		"name":                   name,
		"project_dir":            record.GetString("project_dir"),
		"source":                 record.GetString("source"),
		"status":                 record.GetString("status"),
		"runtime_status":         runtimeStatus,
		"last_deployment_status": record.GetString("last_deployment_status"),
		"last_action":            record.GetString("last_action"),
		"created":                record.GetDateTime("created").String(),
		"updated":                record.GetDateTime("updated").String(),
	}
	if strings.TrimSpace(runtimeReason) != "" {
		result["runtime_reason"] = runtimeReason
	}
	if value := record.GetDateTime("last_action_at"); !value.IsZero() {
		result["last_action_at"] = value.String()
	}
	if value := record.GetDateTime("last_deployed_at"); !value.IsZero() {
		result["last_deployed_at"] = value.String()
	}
	return result
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

func markAppAction(record *core.Record, action string, runtimeStatus string, runtimeReason string) {
	record.Set("last_action", action)
	record.Set("last_action_at", time.Now())
	record.Set("runtime_status", runtimeStatus)
	record.Set("runtime_reason", runtimeReason)
	if action != "uninstall" {
		record.Set("status", "installed")
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

func syncAppInstanceFromDeployment(app core.App, deploymentRecord *core.Record) error {
	if deploymentRecord == nil || deploymentRecord.GetString("status") != deploy.StatusSuccess {
		return nil
	}

	col, err := app.FindCollectionByNameOrId("app_instances")
	if err != nil {
		return err
	}

	projectDir := deploymentRecord.GetString("project_dir")
	serverID := normalizeAppServerID(deploymentRecord.GetString("server_id"))
	filter := fmt.Sprintf(`server_id = "%s" && project_dir = "%s"`, serverID, projectDir)
	record, err := app.FindFirstRecordByFilter("app_instances", filter)
	if err != nil || record == nil {
		record = core.NewRecord(col)
	}

	record.Set("deployment_id", deploymentRecord.Id)
	record.Set("server_id", serverID)
	record.Set("name", deploymentRecord.GetString("compose_project_name"))
	record.Set("project_dir", projectDir)
	record.Set("source", deploymentRecord.GetString("source"))
	record.Set("status", "installed")
	record.Set("runtime_status", "running")
	record.Set("runtime_reason", "")
	record.Set("last_deployment_status", deploymentRecord.GetString("status"))
	record.Set("last_action", "deploy")
	record.Set("last_action_at", time.Now())
	record.Set("last_deployed_at", time.Now())

	if err := saveAppComposeToIAC(record.Id, deploymentRecord.GetString("compose_project_name"), deploymentRecord.GetString("rendered_compose")); err != nil {
		return err
	}

	return app.Save(record)
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
	value := record.Get("config_rollback_snapshot")
	if value == nil {
		return appConfigRollbackSnapshot{}, false
	}

	snapshot := appConfigRollbackSnapshot{}
	switch typed := value.(type) {
	case map[string]any:
		snapshot.Content = strings.TrimSpace(fmt.Sprint(typed["content"]))
		snapshot.SavedAt = strings.TrimSpace(fmt.Sprint(typed["saved_at"]))
		snapshot.SourceAction = strings.TrimSpace(fmt.Sprint(typed["source_action"]))
	default:
		raw, err := json.Marshal(typed)
		if err != nil || json.Unmarshal(raw, &snapshot) != nil {
			return appConfigRollbackSnapshot{}, false
		}
		snapshot.Content = strings.TrimSpace(snapshot.Content)
		snapshot.SavedAt = strings.TrimSpace(snapshot.SavedAt)
		snapshot.SourceAction = strings.TrimSpace(snapshot.SourceAction)
	}

	if snapshot.Content == "" {
		return appConfigRollbackSnapshot{}, false
	}
	return snapshot, true
}

func setAppConfigRollbackSnapshot(record *core.Record, content string, sourceAction string) {
	content = strings.TrimSpace(content)
	if content == "" {
		record.Set("config_rollback_snapshot", nil)
		return
	}
	record.Set("config_rollback_snapshot", map[string]any{
		"content":       content,
		"saved_at":      time.Now().UTC().Format(time.RFC3339),
		"source_action": strings.TrimSpace(sourceAction),
	})
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
