package routes

import (
	"net/http"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

const cronLogsLimit = 50

// registerCronLogsRoute mounts GET /api/crons/{jobId}/logs directly on se.Router
// so it lives alongside PocketBase native cron endpoints under /api/crons.
// Auth requirement mirrors native GET /api/crons (superuser only).
func registerCronLogsRoute(se *core.ServeEvent) {
	se.Router.GET("/api/crons/{jobId}/logs", handleCronLogs).
		Bind(apis.RequireSuperuserAuth())
}

// handleCronLogs returns recent structured execution logs for one cron job.
//
// @Summary Get cron job execution logs
// @Description Returns recent structured execution log lines for one cron job, filtered from PocketBase _logs. Superuser only.
// @Tags System Cron
// @Security BearerAuth
// @Param jobId path string true "Cron job ID"
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/crons/{jobId}/logs [get]
func handleCronLogs(e *core.RequestEvent) error {
	jobID := e.Request.PathValue("jobId")
	if jobID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"code": 400, "message": "jobId is required"})
	}

	var logs []*core.Log
	err := e.App.LogQuery().
		AndWhere(dbx.NewExp("json_extract(data, '$.type') = {:type}", dbx.Params{"type": "cron"})).
		AndWhere(dbx.NewExp("json_extract(data, '$.component') = {:component}", dbx.Params{"component": "system_cron"})).
		AndWhere(dbx.NewExp("json_extract(data, '$.job_id') = {:job_id}", dbx.Params{"job_id": jobID})).
		OrderBy("created DESC").
		Limit(cronLogsLimit).
		All(&logs)
	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{"code": 500, "message": "failed to query cron logs"})
	}

	items := make([]map[string]any, 0, len(logs))
	for _, l := range logs {
		item := map[string]any{
			"created": l.Created,
			"level":   l.Level,
			"message": l.Message,
			"runId":   dataStr(l.Data, "run_id"),
			"phase":   dataStr(l.Data, "phase"),
			"trigger": dataStr(l.Data, "trigger"),
		}
		if v, ok := l.Data["duration_ms"]; ok {
			item["durationMs"] = v
		} else {
			item["durationMs"] = nil
		}
		if v, ok := l.Data["error"]; ok {
			item["error"] = v
		} else {
			item["error"] = nil
		}
		items = append(items, item)
	}

	resp := map[string]any{
		"jobId":          jobID,
		"lastRun":        nil,
		"lastStatus":     nil,
		"lastDurationMs": nil,
		"items":          items,
	}

	// Derive summary from the most recent terminal log (success or error phase).
	for _, l := range logs {
		phase := dataStr(l.Data, "phase")
		if phase == "success" || phase == "error" {
			resp["lastRun"] = l.Created
			resp["lastStatus"] = phase
			if v, ok := l.Data["duration_ms"]; ok {
				resp["lastDurationMs"] = v
			}
			break
		}
	}

	return e.JSON(http.StatusOK, resp)
}

// dataStr returns a string value from a JSONMap[any], or empty string if missing/non-string.
func dataStr(data map[string]any, key string) string {
	if v, ok := data[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}
