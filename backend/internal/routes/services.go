package routes

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/internal/audit"
	"github.com/websoft9/appos/backend/internal/supervisor"
)

// registerServiceRoutes registers supervisord service management routes.
//
// Endpoints:
//
//	GET    /api/ext/services           — list all programs + status + resources
//	POST   /api/ext/services/:name/start   — start a program
//	POST   /api/ext/services/:name/stop    — stop a program
//	POST   /api/ext/services/:name/restart — restart a program
//	GET    /api/ext/services/:name/logs    — read program logs
func registerServiceRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	svc := g.Group("/services")

	svc.GET("", handleServiceList)
	svc.POST("/{name}/start", handleServiceStart)
	svc.POST("/{name}/stop", handleServiceStop)
	svc.POST("/{name}/restart", handleServiceRestart)
	svc.GET("/{name}/logs", handleServiceLogs)
}

func newSupervisorClient() *supervisor.Client {
	return supervisor.NewClient(supervisor.DefaultConfig())
}

func handleServiceList(e *core.RequestEvent) error {
	client := newSupervisorClient()

	processes, err := client.GetAllProcessInfo()
	if err != nil {
		return e.JSON(http.StatusServiceUnavailable, map[string]any{
			"error":   "supervisord_unavailable",
			"message": err.Error(),
		})
	}

	// Collect PIDs for resource monitoring
	pids := make([]int, 0, len(processes))
	for _, p := range processes {
		if p.PID > 0 {
			pids = append(pids, p.PID)
		}
	}

	// Enrich with CPU/Memory from ps
	resources := supervisor.GetProcessResources(pids)
	for i := range processes {
		if r, ok := resources[processes[i].PID]; ok {
			processes[i].CPU = r.CPU
			processes[i].Memory = r.Memory
		}
	}

	// Compute summary stats
	var totalCount, runningCount, stoppedCount, errorCount int
	var totalCPU float64
	var totalMemory int64
	for _, p := range processes {
		totalCount++
		switch p.StateName {
		case "RUNNING":
			runningCount++
		case "STOPPED":
			stoppedCount++
		case "FATAL", "EXITED", "UNKNOWN":
			errorCount++
		}
		totalCPU += p.CPU
		totalMemory += p.Memory
	}

	return e.JSON(http.StatusOK, map[string]any{
		"processes": processes,
		"summary": map[string]any{
			"total":       totalCount,
			"running":     runningCount,
			"stopped":     stoppedCount,
			"error":       errorCount,
			"totalCPU":    totalCPU,
			"totalMemory": totalMemory,
		},
	})
}

func handleServiceStart(e *core.RequestEvent) error {
	name := e.Request.PathValue("name")
	if name == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "missing service name",
		})
	}

	client := newSupervisorClient()
	if err := client.StartProcess(name); err != nil {
		// Idempotent: starting an already-running process is not an error
		if strings.Contains(err.Error(), "ALREADY_STARTED") {
			return e.JSON(http.StatusOK, map[string]any{
				"success": true,
				"message": name + " is already running",
			})
		}
		if strings.Contains(err.Error(), "BAD_NAME") {
			return e.JSON(http.StatusNotFound, map[string]any{
				"error":   "not_found",
				"message": "service not found: " + name,
			})
		}
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "start_failed",
			"message": err.Error(),
		})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"success": true,
		"message": name + " started",
	})
}

func handleServiceStop(e *core.RequestEvent) error {
	name := e.Request.PathValue("name")
	if name == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "missing service name",
		})
	}

	client := newSupervisorClient()
	if err := client.StopProcess(name); err != nil {
		// Idempotent: stopping an already-stopped process is not an error
		if strings.Contains(err.Error(), "NOT_RUNNING") {
			return e.JSON(http.StatusOK, map[string]any{
				"success": true,
				"message": name + " is already stopped",
			})
		}
		if strings.Contains(err.Error(), "BAD_NAME") {
			return e.JSON(http.StatusNotFound, map[string]any{
				"error":   "not_found",
				"message": "service not found: " + name,
			})
		}
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "stop_failed",
			"message": err.Error(),
		})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"success": true,
		"message": name + " stopped",
	})
}

func handleServiceRestart(e *core.RequestEvent) error {
	name := e.Request.PathValue("name")
	if name == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "missing service name",
		})
	}

	userID, userEmail, ip, ua := clientInfo(e)
	client := newSupervisorClient()
	if err := client.RestartProcess(name); err != nil {
		if strings.Contains(err.Error(), "BAD_NAME") {
			return e.JSON(http.StatusNotFound, map[string]any{
				"error":   "not_found",
				"message": "service not found: " + name,
			})
		}
		audit.Write(e.App, audit.Entry{
			UserID: userID, UserEmail: userEmail,
			Action: "service.restart", ResourceType: "service",
			ResourceID: name, ResourceName: name,
			IP: ip, UserAgent: ua,
			Status: audit.StatusFailed,
			Detail: map[string]any{"errorMessage": err.Error()},
		})
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "restart_failed",
			"message": err.Error(),
		})
	}
	audit.Write(e.App, audit.Entry{
		UserID: userID, UserEmail: userEmail,
		Action: "service.restart", ResourceType: "service",
		ResourceID: name, ResourceName: name,
		IP: ip, UserAgent: ua,
		Status: audit.StatusSuccess,
	})

	return e.JSON(http.StatusOK, map[string]any{
		"success": true,
		"message": name + " restarted",
	})
}

func handleServiceLogs(e *core.RequestEvent) error {
	name := e.Request.PathValue("name")
	if name == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{
			"error": "missing service name",
		})
	}

	// Query params: type=stdout|stderr, length=bytes (default 64KB)
	logType := e.Request.URL.Query().Get("type")
	if logType == "" {
		logType = "stdout"
	}

	lengthStr := e.Request.URL.Query().Get("length")
	length := 65536 // default 64KB
	if lengthStr != "" {
		if l, err := strconv.Atoi(lengthStr); err == nil && l > 0 {
			if l > 1048576 { // max 1MB
				l = 1048576
			}
			length = l
		}
	}

	client := newSupervisorClient()

	var logContent string
	var err error
	if logType == "stderr" {
		logContent, _, _, err = client.TailErrLog(name, 0, length)
	} else {
		logContent, _, _, err = client.TailLog(name, 0, length)
	}

	if err != nil {
		return e.JSON(http.StatusInternalServerError, map[string]any{
			"error":   "logs_failed",
			"message": err.Error(),
		})
	}

	return e.JSON(http.StatusOK, map[string]any{
		"name":    name,
		"type":    logType,
		"content": logContent,
	})
}
