package routes

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
)

func registerMonitorRoutes(se *core.ServeEvent) {
	monitorGroup := se.Router.Group("/api/monitor")
	monitorGroup.Bind(apis.RequireAuth())
	monitorGroup.GET("/overview", handleMonitorOverview)
	monitorGroup.GET("/targets/{targetType}/{targetId}", handleMonitorTargetStatus)
	monitorGroup.GET("/targets/{targetType}/{targetId}/series", handleMonitorTargetSeries)

	bootstrap := se.Router.Group("/api/monitor")
	bootstrap.Bind(apis.RequireSuperuserAuth())
	bootstrap.POST("/servers/{id}/agent-token", handleMonitorAgentToken)
	bootstrap.GET("/servers/{id}/agent-setup", handleMonitorAgentSetup)

	ingest := se.Router.Group("/api/monitor/ingest")
	ingest.POST("/metrics", handleMonitorMetrics)
	ingest.POST("/heartbeat", handleMonitorHeartbeat)
	ingest.POST("/runtime-status", handleMonitorRuntimeStatus)
}

func handleMonitorMetrics(e *core.RequestEvent) error {
	token, err := monitorBearerToken(e.Request.Header.Get("Authorization"))
	if err != nil {
		return apis.NewUnauthorizedError("missing monitor token", err)
	}
	authenticatedServerID, err := monitor.ValidateAgentToken(e.App, token)
	if err != nil {
		return apis.NewUnauthorizedError("invalid monitor token", err)
	}

	var body struct {
		ServerID   string `json:"serverId"`
		ReportedAt string `json:"reportedAt"`
		Items      []struct {
			TargetType string            `json:"targetType"`
			TargetID   string            `json:"targetId"`
			Series     string            `json:"series"`
			Value      float64           `json:"value"`
			Unit       string            `json:"unit"`
			Labels     map[string]string `json:"labels"`
			ObservedAt string            `json:"observedAt"`
		} `json:"items"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid body", err)
	}
	if strings.TrimSpace(body.ServerID) == "" || strings.TrimSpace(body.ReportedAt) == "" || len(body.Items) == 0 {
		return e.BadRequestError("serverId, reportedAt, and items are required", nil)
	}
	if body.ServerID != authenticatedServerID {
		return apis.NewForbiddenError("server ownership mismatch", nil)
	}
	if len(body.Items) > monitor.MetricsBatchLimit {
		return e.BadRequestError("metrics batch too large", nil)
	}
	reportedAt, err := time.Parse(time.RFC3339, body.ReportedAt)
	if err != nil {
		return e.BadRequestError("reportedAt must be RFC3339", err)
	}
	points := make([]monitor.MetricPoint, 0, len(body.Items))
	for _, item := range body.Items {
		observedAt := reportedAt
		if strings.TrimSpace(item.ObservedAt) != "" {
			observedAt, err = time.Parse(time.RFC3339, item.ObservedAt)
			if err != nil {
				return e.BadRequestError("observedAt must be RFC3339", err)
			}
		}
		labels := make(map[string]string, len(item.Labels)+3)
		for key, value := range item.Labels {
			labels[key] = value
		}
		labels["server_id"] = body.ServerID
		labels["target_type"] = strings.TrimSpace(item.TargetType)
		labels["target_id"] = strings.TrimSpace(item.TargetID)
		if labels["target_type"] == "" || labels["target_id"] == "" {
			return e.BadRequestError("targetType and targetId are required", nil)
		}
		if labels["target_type"] == monitor.TargetTypeServer && labels["target_id"] != body.ServerID {
			return e.BadRequestError("server metric targetId must match serverId", nil)
		}
		points = append(points, monitor.MetricPoint{
			Series:     strings.TrimSpace(item.Series),
			Value:      item.Value,
			Labels:     labels,
			ObservedAt: observedAt,
		})
	}
	if err := monitor.WriteMetricPoints(e.Request.Context(), points); err != nil {
		return e.BadRequestError("failed to ingest metrics", err)
	}
	return e.JSON(http.StatusAccepted, map[string]any{"ok": true, "accepted": len(points)})
}

func handleMonitorRuntimeStatus(e *core.RequestEvent) error {
	token, err := monitorBearerToken(e.Request.Header.Get("Authorization"))
	if err != nil {
		return apis.NewUnauthorizedError("missing monitor token", err)
	}
	authenticatedServerID, err := monitor.ValidateAgentToken(e.App, token)
	if err != nil {
		return apis.NewUnauthorizedError("invalid monitor token", err)
	}

	var body struct {
		ServerID   string `json:"serverId"`
		ReportedAt string `json:"reportedAt"`
		Items      []struct {
			TargetType   string `json:"targetType"`
			TargetID     string `json:"targetId"`
			RuntimeState string `json:"runtimeState"`
			ObservedAt   string `json:"observedAt"`
			Containers   struct {
				Running    int `json:"running"`
				Restarting int `json:"restarting"`
				Exited     int `json:"exited"`
			} `json:"containers"`
			Apps []struct {
				AppID        string `json:"appId"`
				RuntimeState string `json:"runtimeState"`
			} `json:"apps"`
		} `json:"items"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid body", err)
	}
	if strings.TrimSpace(body.ServerID) == "" || strings.TrimSpace(body.ReportedAt) == "" || len(body.Items) == 0 {
		return e.BadRequestError("serverId, reportedAt, and items are required", nil)
	}
	if body.ServerID != authenticatedServerID {
		return apis.NewForbiddenError("server ownership mismatch", nil)
	}
	if len(body.Items) > monitor.RuntimeStatusBatchLimit {
		return e.BadRequestError("runtime-status batch too large", nil)
	}
	reportedAt, err := time.Parse(time.RFC3339, body.ReportedAt)
	if err != nil {
		return e.BadRequestError("reportedAt must be RFC3339", err)
	}
	server, err := findMonitorServer(e.App, body.ServerID)
	if err != nil {
		return e.NotFoundError("server not found", err)
	}
	accepted := 0
	for _, item := range body.Items {
		if strings.TrimSpace(item.TargetType) != monitor.TargetTypeServer || strings.TrimSpace(item.TargetID) != body.ServerID {
			return e.BadRequestError("runtime-status currently supports only server targets matching serverId", nil)
		}
		observedAt := reportedAt
		if strings.TrimSpace(item.ObservedAt) != "" {
			observedAt, err = time.Parse(time.RFC3339, item.ObservedAt)
			if err != nil {
				return e.BadRequestError("observedAt must be RFC3339", err)
			}
		}
		summary := monitor.LoadExistingSummary(e.App, monitor.TargetTypeServer, body.ServerID)
		summary["runtime_state"] = strings.TrimSpace(item.RuntimeState)
		summary["containers_running"] = item.Containers.Running
		summary["containers_restarting"] = item.Containers.Restarting
		summary["containers_exited"] = item.Containers.Exited
		summary["app_count"] = len(item.Apps)
		if len(item.Apps) > 0 {
			apps := make([]map[string]any, 0, len(item.Apps))
			for _, appItem := range item.Apps {
				appID := strings.TrimSpace(appItem.AppID)
				appRuntimeState := strings.TrimSpace(appItem.RuntimeState)
				apps = append(apps, map[string]any{
					"app_id":        appID,
					"runtime_state": appRuntimeState,
				})
				if appID == "" {
					continue
				}
				appDisplayName := appID
				if appRecord, findErr := e.App.FindRecordById("app_instances", appID); findErr == nil {
					if name := strings.TrimSpace(appRecord.GetString("name")); name != "" {
						appDisplayName = name
					}
				}
				appStatus := monitor.StatusUnknown
				appReason := "app runtime reported"
				switch strings.ToLower(appRuntimeState) {
				case "running", "healthy":
					appStatus = monitor.StatusHealthy
					appReason = ""
				case "degraded", "restarting":
					appStatus = monitor.StatusDegraded
					appReason = "app runtime degraded"
				case "stopped", "stopping", "exited":
					appStatus = monitor.StatusUnknown
					appReason = "app is not running"
				}
				appFailures := 0
				appLastSuccessAt := (*time.Time)(nil)
				appLastFailureAt := (*time.Time)(nil)
				if appStatus == monitor.StatusHealthy {
					appLastSuccessAt = &observedAt
				} else if appStatus == monitor.StatusDegraded {
					appFailures = 1
					appLastFailureAt = &observedAt
				}
				appSummary := monitor.LoadExistingSummary(e.App, monitor.TargetTypeApp, appID)
				appSummary["runtime_state"] = appRuntimeState
				appSummary["server_id"] = body.ServerID
				_, err = monitor.UpsertLatestStatus(e.App, monitor.LatestStatusUpsert{
					TargetType:              monitor.TargetTypeApp,
					TargetID:                appID,
					DisplayName:             appDisplayName,
					Status:                  appStatus,
					Reason:                  appReason,
					SignalSource:            monitor.SignalSourceAgent,
					LastTransitionAt:        observedAt,
					LastSuccessAt:           appLastSuccessAt,
					LastFailureAt:           appLastFailureAt,
					LastCheckedAt:           &observedAt,
					LastReportedAt:          &observedAt,
					ConsecutiveFailures:     &appFailures,
					Summary:                 appSummary,
					PreserveStrongerFailure: true,
				})
				if err != nil {
					return e.InternalServerError("failed to persist app runtime summary", err)
				}
			}
			summary["apps"] = apps
		} else {
			delete(summary, "apps")
		}

		status := monitor.StatusUnknown
		reason := "runtime summary reported"
		switch strings.ToLower(strings.TrimSpace(item.RuntimeState)) {
		case "running", "healthy":
			status = monitor.StatusHealthy
			reason = ""
		case "degraded", "restarting":
			status = monitor.StatusDegraded
			reason = "runtime degraded"
		case "stopped", "stopping", "exited":
			status = monitor.StatusUnknown
			reason = "runtime not running"
		}
		failures := 0
		lastSuccessAt := (*time.Time)(nil)
		lastFailureAt := (*time.Time)(nil)
		if status == monitor.StatusHealthy {
			lastSuccessAt = &observedAt
		} else if status == monitor.StatusDegraded {
			failures = 1
			lastFailureAt = &observedAt
		}
		_, err = monitor.UpsertLatestStatus(e.App, monitor.LatestStatusUpsert{
			TargetType:              monitor.TargetTypeServer,
			TargetID:                body.ServerID,
			DisplayName:             server.GetString("name"),
			Status:                  status,
			Reason:                  reason,
			SignalSource:            monitor.SignalSourceAgent,
			LastTransitionAt:        observedAt,
			LastSuccessAt:           lastSuccessAt,
			LastFailureAt:           lastFailureAt,
			LastCheckedAt:           &observedAt,
			LastReportedAt:          &observedAt,
			ConsecutiveFailures:     &failures,
			Summary:                 summary,
			PreserveStrongerFailure: true,
		})
		if err != nil {
			return e.InternalServerError("failed to persist runtime summary", err)
		}
		accepted++
	}
	return e.JSON(http.StatusAccepted, map[string]any{"ok": true, "accepted": accepted})
}

func handleMonitorAgentToken(e *core.RequestEvent) error {
	server, err := findMonitorServer(e.App, e.Request.PathValue("id"))
	if err != nil {
		return e.NotFoundError("server not found", err)
	}
	rotate := strings.EqualFold(strings.TrimSpace(e.Request.URL.Query().Get("rotate")), "true")
	token, changed, err := monitor.GetOrIssueAgentToken(e.App, server.Id, rotate)
	if err != nil {
		return e.InternalServerError("failed to issue monitor token", err)
	}
	return e.JSON(http.StatusOK, map[string]any{
		"serverId": server.Id,
		"token":    token,
		"rotated":  rotate && changed,
		"created":  changed && !rotate,
	})
}

func handleMonitorAgentSetup(e *core.RequestEvent) error {
	server, err := findMonitorServer(e.App, e.Request.PathValue("id"))
	if err != nil {
		return e.NotFoundError("server not found", err)
	}
	token, _, err := monitor.GetOrIssueAgentToken(e.App, server.Id, false)
	if err != nil {
		return e.InternalServerError("failed to load monitor token", err)
	}
	baseURL := monitorBaseURL(e)
	return e.JSON(http.StatusOK, map[string]any{
		"serverId":      server.Id,
		"token":         token,
		"ingestBaseUrl": baseURL + "/api/monitor/ingest",
		"systemdUnit":   monitorSystemdUnit(),
		"configYaml":    monitorAgentConfigYAML(server.Id, baseURL, token),
	})
}

func handleMonitorHeartbeat(e *core.RequestEvent) error {
	token, err := monitorBearerToken(e.Request.Header.Get("Authorization"))
	if err != nil {
		return apis.NewUnauthorizedError("missing monitor token", err)
	}
	authenticatedServerID, err := monitor.ValidateAgentToken(e.App, token)
	if err != nil {
		return apis.NewUnauthorizedError("invalid monitor token", err)
	}

	var body struct {
		ServerID     string `json:"serverId"`
		AgentVersion string `json:"agentVersion"`
		ReportedAt   string `json:"reportedAt"`
		Items        []struct {
			TargetType string `json:"targetType"`
			TargetID   string `json:"targetId"`
			Status     string `json:"status"`
			Reason     string `json:"reason"`
			ObservedAt string `json:"observedAt"`
		} `json:"items"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid body", err)
	}
	if strings.TrimSpace(body.ServerID) == "" || strings.TrimSpace(body.ReportedAt) == "" || len(body.Items) == 0 {
		return e.BadRequestError("serverId, reportedAt, and items are required", nil)
	}
	if body.ServerID != authenticatedServerID {
		return apis.NewForbiddenError("server ownership mismatch", nil)
	}
	server, err := findMonitorServer(e.App, body.ServerID)
	if err != nil {
		return e.NotFoundError("server not found", err)
	}
	reportedAt, err := time.Parse(time.RFC3339, body.ReportedAt)
	if err != nil {
		return e.BadRequestError("reportedAt must be RFC3339", err)
	}
	now := time.Now().UTC()
	accepted := 0
	for _, item := range body.Items {
		if item.TargetType != monitor.TargetTypeServer {
			return e.BadRequestError("first slice only supports server heartbeat targets", nil)
		}
		if strings.TrimSpace(item.TargetID) == "" || item.TargetID != body.ServerID {
			return e.BadRequestError("targetId must match serverId for server heartbeats", nil)
		}
		observedAt := reportedAt
		if strings.TrimSpace(item.ObservedAt) != "" {
			observedAt, err = time.Parse(time.RFC3339, item.ObservedAt)
			if err != nil {
				return e.BadRequestError("observedAt must be RFC3339", err)
			}
		}
		projection := monitor.EvaluateHeartbeat(observedAt, now)
		summary := map[string]any{
			"heartbeat_state": projection.HeartbeatState,
		}
		if strings.TrimSpace(body.AgentVersion) != "" {
			summary["agent_version"] = body.AgentVersion
		}
		failures := 0
		lastSuccessAt := (*time.Time)(nil)
		lastFailureAt := (*time.Time)(nil)
		if projection.Status == monitor.StatusHealthy {
			lastSuccessAt = &observedAt
		} else {
			failures = 1
			nowUTC := now.UTC()
			lastFailureAt = &nowUTC
		}
		_, err = monitor.UpsertLatestStatus(e.App, monitor.LatestStatusUpsert{
			TargetType:              monitor.TargetTypeServer,
			TargetID:                body.ServerID,
			DisplayName:             server.GetString("name"),
			Status:                  projection.Status,
			Reason:                  projection.Reason,
			SignalSource:            monitor.SignalSourceAgent,
			LastTransitionAt:        now,
			LastSuccessAt:           lastSuccessAt,
			LastFailureAt:           lastFailureAt,
			LastReportedAt:          &observedAt,
			ConsecutiveFailures:     &failures,
			Summary:                 summary,
			PreserveStrongerFailure: true,
		})
		if err != nil {
			return e.InternalServerError("failed to persist latest status", err)
		}
		accepted++
	}
	return e.JSON(http.StatusAccepted, map[string]any{"ok": true, "accepted": accepted})
}

func handleMonitorOverview(e *core.RequestEvent) error {
	if err := monitor.RefreshHeartbeatFreshness(e.App, time.Now().UTC()); err != nil {
		return e.InternalServerError("failed to refresh heartbeat freshness", err)
	}
	overview, err := monitor.BuildOverview(e.App)
	if err != nil {
		return e.InternalServerError("failed to build overview", err)
	}
	return e.JSON(http.StatusOK, overview)
}

func handleMonitorTargetSeries(e *core.RequestEvent) error {
	window := strings.TrimSpace(e.Request.URL.Query().Get("window"))
	if window == "" {
		window = "1h"
	}
	options := monitor.MetricSeriesQueryOptions{
		NetworkInterface: strings.TrimSpace(e.Request.URL.Query().Get("networkInterface")),
	}
	requestedSeries := []string{}
	if raw := strings.TrimSpace(e.Request.URL.Query().Get("series")); raw != "" {
		requestedSeries = append(requestedSeries, raw)
	}
	response, err := monitor.QueryMetricSeries(
		e.Request.Context(),
		e.Request.PathValue("targetType"),
		e.Request.PathValue("targetId"),
		window,
		requestedSeries,
		options,
	)
	if err != nil {
		return e.BadRequestError("failed to query monitor series", err)
	}
	return e.JSON(http.StatusOK, response)
}

func handleMonitorTargetStatus(e *core.RequestEvent) error {
	response, err := monitor.GetTargetStatus(
		e.App,
		e.Request.PathValue("targetType"),
		e.Request.PathValue("targetId"),
	)
	if err != nil {
		return e.NotFoundError("monitor target not found", err)
	}
	return e.JSON(http.StatusOK, response)
}

func findMonitorServer(app core.App, serverID string) (*core.Record, error) {
	return app.FindRecordById("servers", strings.TrimSpace(serverID))
}

func monitorBearerToken(header string) (string, error) {
	header = strings.TrimSpace(header)
	if !strings.HasPrefix(strings.ToLower(header), "bearer ") {
		return "", fmt.Errorf("missing bearer token")
	}
	value := strings.TrimSpace(header[7:])
	if value == "" {
		return "", fmt.Errorf("missing bearer token")
	}
	return value, nil
}

func monitorBaseURL(e *core.RequestEvent) string {
	scheme := "http"
	if strings.EqualFold(strings.TrimSpace(e.Request.Header.Get("X-Forwarded-Proto")), "https") || e.Request.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + resolveMonitorHTTPHost(e)
}

func resolveMonitorHTTPHost(e *core.RequestEvent) string {
	host := firstForwardedHostValue(e.Request.Host)
	forwardedHost := firstForwardedHostValue(e.Request.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = forwardedHost
	}
	if forwardedHost != "" && forwardedHostCarriesPort(host, forwardedHost) {
		host = forwardedHost
	}
	if !hostHasExplicitPort(host) {
		if forwardedPort := firstForwardedPortValue(e.Request.Header.Get("X-Forwarded-Port")); forwardedPort != "" {
			host = appendPortIfMissing(host, forwardedPort)
		}
	}
	if host == "" {
		host = "appos-host"
	}
	return host
}

func firstForwardedHostValue(value string) string {
	value = strings.TrimSpace(value)
	if idx := strings.Index(value, ","); idx >= 0 {
		value = strings.TrimSpace(value[:idx])
	}
	return value
}

func firstForwardedPortValue(value string) string {
	value = firstForwardedHostValue(value)
	if value == "" {
		return ""
	}
	for _, ch := range value {
		if ch < '0' || ch > '9' {
			return ""
		}
	}
	return value
}

func forwardedHostCarriesPort(requestHost string, forwardedHost string) bool {
	if !hostHasExplicitPort(forwardedHost) {
		return false
	}
	if requestHost == "" || !hostHasExplicitPort(requestHost) {
		return sameHostWithoutPort(requestHost, forwardedHost)
	}
	return false
}

func sameHostWithoutPort(left string, right string) bool {
	return stripOptionalPort(left) == stripOptionalPort(right)
}

func stripOptionalPort(host string) string {
	if strings.HasPrefix(host, "[") {
		if idx := strings.LastIndex(host, "]:"); idx >= 0 {
			return host[:idx+1]
		}
		return host
	}
	idx := strings.LastIndex(host, ":")
	if idx <= 0 || strings.Contains(host[:idx], ":") {
		return host
	}
	for _, ch := range host[idx+1:] {
		if ch < '0' || ch > '9' {
			return host
		}
	}
	return host[:idx]
}

func hostHasExplicitPort(host string) bool {
	return stripOptionalPort(host) != host
}

func appendPortIfMissing(host string, port string) string {
	if host == "" || port == "" || hostHasExplicitPort(host) {
		return host
	}
	if strings.HasPrefix(host, "[") {
		return host + ":" + port
	}
	return host + ":" + port
}

func monitorAgentConfigYAML(serverID string, baseURL string, token string) string {
	return fmt.Sprintf("server_id: %s\ninterval: %s\ningest_base_url: %s/api/monitor/ingest\ntoken: %s\ntimeout: 10s\n", serverID, monitor.ExpectedHeartbeatInterval, baseURL, token)
}

func monitorSystemdUnit() string {
	return "[Unit]\nDescription=AppOS Monitor Agent\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart=/usr/local/bin/appos-monitor-agent --config /etc/appos-monitor-agent.yaml\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=multi-user.target\n"
}
