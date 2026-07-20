package routes

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/websoft9/appos/backend/domain/audit"
	serversvc "github.com/websoft9/appos/backend/domain/resource/servers/service"
	"github.com/websoft9/appos/backend/domain/terminal"
)

var (
	executeServerCronCommand = terminal.ExecuteSSHCommand
)

const managedCronMarkerPrefix = serversvc.ManagedCronMarkerPrefix

const maxManagedCronTestOutputLen = 4096

type managedCronWriteRequest struct {
	Name          string `json:"name"`
	Schedule      string `json:"schedule"`
	Command       string `json:"command"`
	Enabled       bool   `json:"enabled"`
	SingleRunOnly bool   `json:"singleRunOnly"`
}

type managedCronJob = serversvc.ManagedCronJob

type managedCronTestResponse struct {
	EntryID string `json:"entryId"`
	Output  string `json:"output"`
}

// @Summary List managed cron jobs for a server
// @Description Returns AppOS-managed cron jobs from the target server crontab. Superuser only.
// @Tags Server Operations
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/ops/cron/jobs [get]
func handleServerCronJobsList(e *core.RequestEvent) error {
	serverID := strings.TrimSpace(e.Request.PathValue("serverId"))
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}

	cfg, err := resolveTerminalConfig(e.App, e.Auth, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	items, err := serverCronService(cfg).List(e.Request.Context())
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error()})
	}

	auditServerCron(e, serverID, "server.ops.cron.list", audit.StatusSuccess, map[string]any{"count": len(items)})
	return e.JSON(http.StatusOK, map[string]any{"items": items})
}

// @Summary Create a managed cron job for a server
// @Description Creates a new AppOS-managed cron entry on the target server. Superuser only.
// @Tags Server Operations
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param body body managedCronWriteRequest true "cron job payload"
// @Success 200 {object} managedCronJob
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/ops/cron/jobs [post]
func handleServerCronJobCreate(e *core.RequestEvent) error {
	serverID := strings.TrimSpace(e.Request.PathValue("serverId"))
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}

	job, err := bindManagedCronWriteRequest(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	cfg, err := resolveTerminalConfig(e.App, e.Auth, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	job, output, err := serverCronService(cfg).Create(e.Request.Context(), job)
	if err != nil {
		auditServerCron(e, serverID, "server.ops.cron.create", audit.StatusFailed, map[string]any{"entry_id": job.EntryID, "output": output})
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error(), "output": output})
	}

	auditServerCron(e, serverID, "server.ops.cron.create", audit.StatusSuccess, map[string]any{"entry_id": job.EntryID, "output": output})
	return e.JSON(http.StatusOK, job)
}

// @Summary Update a managed cron job for a server
// @Description Updates one AppOS-managed cron entry on the target server. Superuser only.
// @Tags Server Operations
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param entryId path string true "managed cron entry ID"
// @Param body body managedCronWriteRequest true "cron job payload"
// @Success 200 {object} managedCronJob
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/ops/cron/jobs/{entryId} [put]
func handleServerCronJobUpdate(e *core.RequestEvent) error {
	serverID := strings.TrimSpace(e.Request.PathValue("serverId"))
	entryID := strings.TrimSpace(e.Request.PathValue("entryId"))
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}
	if entryID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "entryId required"})
	}

	job, err := bindManagedCronWriteRequest(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}
	job.EntryID = entryID

	cfg, err := resolveTerminalConfig(e.App, e.Auth, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	job, output, err := serverCronService(cfg).Update(e.Request.Context(), job)
	if err == serversvc.ErrManagedCronNotFound {
		return e.JSON(http.StatusNotFound, map[string]any{"message": "managed cron entry not found"})
	}
	if err != nil {
		auditServerCron(e, serverID, "server.ops.cron.update", audit.StatusFailed, map[string]any{"entry_id": entryID, "output": output})
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error(), "output": output})
	}

	auditServerCron(e, serverID, "server.ops.cron.update", audit.StatusSuccess, map[string]any{"entry_id": entryID, "output": output})
	return e.JSON(http.StatusOK, job)
}

// @Summary Enable a managed cron job for a server
// @Description Enables one AppOS-managed cron entry on the target server. Superuser only.
// @Tags Server Operations
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param entryId path string true "managed cron entry ID"
// @Success 200 {object} managedCronJob
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/ops/cron/jobs/{entryId}/enable [post]
func handleServerCronJobEnable(e *core.RequestEvent) error {
	return handleServerCronJobToggle(e, true)
}

// @Summary Disable a managed cron job for a server
// @Description Disables one AppOS-managed cron entry on the target server. Superuser only.
// @Tags Server Operations
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param entryId path string true "managed cron entry ID"
// @Success 200 {object} managedCronJob
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/ops/cron/jobs/{entryId}/disable [post]
func handleServerCronJobDisable(e *core.RequestEvent) error {
	return handleServerCronJobToggle(e, false)
}

// @Summary Execute a managed cron job immediately on a server
// @Description Runs one AppOS-managed cron entry immediately on the target server without changing its persisted schedule state. Superuser only.
// @Tags Server Operations
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param entryId path string true "managed cron entry ID"
// @Success 200 {object} managedCronTestResponse
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/ops/cron/jobs/{entryId}/test [post]
func handleServerCronJobTest(e *core.RequestEvent) error {
	serverID := strings.TrimSpace(e.Request.PathValue("serverId"))
	entryID := strings.TrimSpace(e.Request.PathValue("entryId"))
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}
	if entryID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "entryId required"})
	}

	cfg, err := resolveTerminalConfig(e.App, e.Auth, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	job, err := serverCronService(cfg).Get(e.Request.Context(), entryID)
	if err == serversvc.ErrManagedCronNotFound {
		return e.JSON(http.StatusNotFound, map[string]any{"message": "managed cron entry not found"})
	}
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error()})
	}

	output, err := executeServerCronCommand(e.Request.Context(), cfg, serversvc.RenderManagedCronTestCommand(job), 60*time.Second)
	responseOutput := limitManagedCronTestOutput(output)
	if err != nil {
		auditServerCron(e, serverID, "server.ops.cron.test", audit.StatusFailed, map[string]any{"entry_id": entryID, "output_bytes": len(output)})
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error(), "output": responseOutput})
	}

	auditServerCron(e, serverID, "server.ops.cron.test", audit.StatusSuccess, map[string]any{"entry_id": entryID, "output_bytes": len(output)})
	return e.JSON(http.StatusOK, managedCronTestResponse{EntryID: entryID, Output: responseOutput})
}

func handleServerCronJobToggle(e *core.RequestEvent, enabled bool) error {
	serverID := strings.TrimSpace(e.Request.PathValue("serverId"))
	entryID := strings.TrimSpace(e.Request.PathValue("entryId"))
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}
	if entryID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "entryId required"})
	}

	cfg, err := resolveTerminalConfig(e.App, e.Auth, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	job, output, err := serverCronService(cfg).Toggle(e.Request.Context(), entryID, enabled)
	if err == serversvc.ErrManagedCronNotFound {
		return e.JSON(http.StatusNotFound, map[string]any{"message": "managed cron entry not found"})
	}
	if err != nil {
		auditServerCron(e, serverID, "server.ops.cron.toggle", audit.StatusFailed, map[string]any{"entry_id": entryID, "enabled": enabled, "output": output})
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error(), "output": output})
	}

	auditServerCron(e, serverID, "server.ops.cron.toggle", audit.StatusSuccess, map[string]any{"entry_id": entryID, "enabled": enabled, "output": output})
	return e.JSON(http.StatusOK, job)
}

// @Summary Delete a managed cron job for a server
// @Description Deletes one AppOS-managed cron entry from the target server. Superuser only.
// @Tags Server Operations
// @Security BearerAuth
// @Param serverId path string true "server record ID"
// @Param entryId path string true "managed cron entry ID"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/{serverId}/ops/cron/jobs/{entryId} [delete]
func handleServerCronJobDelete(e *core.RequestEvent) error {
	serverID := strings.TrimSpace(e.Request.PathValue("serverId"))
	entryID := strings.TrimSpace(e.Request.PathValue("entryId"))
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}
	if entryID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "entryId required"})
	}

	cfg, err := resolveTerminalConfig(e.App, e.Auth, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	output, err := serverCronService(cfg).Delete(e.Request.Context(), entryID)
	if err == serversvc.ErrManagedCronNotFound {
		return e.JSON(http.StatusNotFound, map[string]any{"message": "managed cron entry not found"})
	}
	if err != nil {
		auditServerCron(e, serverID, "server.ops.cron.delete", audit.StatusFailed, map[string]any{"entry_id": entryID, "output": output})
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": err.Error(), "output": output})
	}

	auditServerCron(e, serverID, "server.ops.cron.delete", audit.StatusSuccess, map[string]any{"entry_id": entryID, "output": output})
	return e.JSON(http.StatusOK, map[string]any{"entryId": entryID, "deleted": true})
}

func bindManagedCronWriteRequest(e *core.RequestEvent) (managedCronJob, error) {
	var body managedCronWriteRequest
	if err := e.BindBody(&body); err != nil {
		return managedCronJob{}, fmt.Errorf("invalid request body")
	}
	job, err := serversvc.NewManagedCronJob(body.Name, body.Schedule, body.Command, body.Enabled, body.SingleRunOnly)
	if err != nil {
		return managedCronJob{}, err
	}
	return job, nil
}

func serverCronService(cfg terminal.ConnectorConfig) serversvc.ManagedCronService {
	return serversvc.ManagedCronService{
		Repository: serversvc.RemoteManagedCronRepository{
			Config:         cfg,
			ExecuteCommand: executeServerCronCommand,
		},
	}
}

func limitManagedCronTestOutput(output string) string {
	if len(output) <= maxManagedCronTestOutputLen {
		return output
	}
	return strings.TrimRight(output[:maxManagedCronTestOutputLen], "\n") + "\n... output truncated ..."
}

func auditServerCron(e *core.RequestEvent, serverID, action, status string, detail map[string]any) {
	userID, _, ip, _ := clientInfo(e)
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       action,
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       status,
		IP:           ip,
		Detail:       detail,
	})
}
