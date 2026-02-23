package routes

import (
	"encoding/json"
	"net/http"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/internal/audit"
	"github.com/websoft9/appos/backend/internal/worker"
)

// registerBackupRoutes registers backup/restore routes.
// All backup routes require superuser authentication.
//
// Endpoints:
//
//	POST /api/ext/backup/create   — enqueue async backup creation
//	POST /api/ext/backup/restore  — restore from a backup (sync)
//	GET  /api/ext/backup/list     — list available backups
func registerBackupRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	backup := g.Group("/backup")
	backup.Bind(apis.RequireSuperuserAuth())

	backup.POST("/create", handleBackupCreate)
	backup.POST("/restore", handleBackupRestore)
	backup.GET("/list", handleBackupList)
}

// handleBackupCreate enqueues an async backup task.
// No pending audit is written because there is no update path once the task
// is handed off to the worker — the worker will write success/failed directly
// when the operation is implemented.
func handleBackupCreate(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "invalid request body"})
	}
	name := bodyString(body, "name")
	if name == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "name is required"})
	}

	userID, userEmail := authInfo(e)
	ip := e.RealIP()
	ua := e.Request.Header.Get("User-Agent")

	payload := worker.BackupCreatePayload{
		UserID:    userID,
		UserEmail: userEmail,
		Name:      name,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to build task payload"})
	}

	if asynqClient == nil {
		return e.JSON(http.StatusServiceUnavailable, map[string]any{"code": 503, "message": "task queue unavailable"})
	}

	task := asynq.NewTask(worker.TaskBackupCreate, raw)
	info, err := asynqClient.Enqueue(task)
	if err != nil {
		audit.Write(e.App, audit.Entry{
			UserID: userID, UserEmail: userEmail,
			Action: "backup.create", ResourceType: "backup", ResourceName: name,
			IP: ip, UserAgent: ua,
			Status: audit.StatusFailed,
			Detail: map[string]any{"errorMessage": err.Error()},
		})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "enqueue failed", "data": map[string]any{"error": err.Error()}})
	}

	return e.JSON(http.StatusAccepted, map[string]any{"taskId": info.ID})
}

// handleBackupRestore runs a backup restore synchronously and writes the audit result.
func handleBackupRestore(e *core.RequestEvent) error {
	body, err := readBody(e)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "invalid request body"})
	}
	name := bodyString(body, "name")
	if name == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "name is required"})
	}

	userID, userEmail := authInfo(e)
	ip := e.RealIP()
	ua := e.Request.Header.Get("User-Agent")

	// TODO: implement actual restore logic (decrypt + extract backup named `name`)
	restoreErr := error(nil)

	if restoreErr != nil {
		audit.Write(e.App, audit.Entry{
			UserID: userID, UserEmail: userEmail,
			Action: "backup.restore", ResourceType: "backup", ResourceName: name,
			IP: ip, UserAgent: ua,
			Status: audit.StatusFailed,
			Detail: map[string]any{"errorMessage": restoreErr.Error()},
		})
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "restore failed", "data": map[string]any{"error": restoreErr.Error()}})
	}

	audit.Write(e.App, audit.Entry{
		UserID: userID, UserEmail: userEmail,
		Action: "backup.restore", ResourceType: "backup", ResourceName: name,
		IP: ip, UserAgent: ua,
		Status: audit.StatusSuccess,
	})
	return e.JSON(http.StatusOK, map[string]any{"message": "ok"})
}

func handleBackupList(e *core.RequestEvent) error {
	// TODO: list available backups from storage
	return e.JSON(http.StatusOK, map[string]any{
		"message": "not implemented",
	})
}
