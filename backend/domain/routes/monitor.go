package routes

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitormetrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
	agentsignals "github.com/websoft9/appos/backend/domain/monitor/signals/agent"
	monitorstatus "github.com/websoft9/appos/backend/domain/monitor/status"
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
	authenticatedServerID, err := agentsignals.ValidateAgentToken(e.App, token)
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
	if len(body.Items) > monitormetrics.MetricsBatchLimit {
		return e.BadRequestError("metrics batch too large", nil)
	}
	reportedAt, err := time.Parse(time.RFC3339, body.ReportedAt)
	if err != nil {
		return e.BadRequestError("reportedAt must be RFC3339", err)
	}
	points := make([]monitormetrics.MetricPoint, 0, len(body.Items))
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
		points = append(points, monitormetrics.MetricPoint{
			Series:     strings.TrimSpace(item.Series),
			Value:      item.Value,
			Labels:     labels,
			ObservedAt: observedAt,
		})
	}
	if err := monitormetrics.WriteMetricPoints(e.Request.Context(), points); err != nil {
		return e.BadRequestError("failed to ingest metrics", err)
	}
	return e.JSON(http.StatusAccepted, map[string]any{"ok": true, "accepted": len(points)})
}

func handleMonitorRuntimeStatus(e *core.RequestEvent) error {
	token, err := monitorBearerToken(e.Request.Header.Get("Authorization"))
	if err != nil {
		return apis.NewUnauthorizedError("missing monitor token", err)
	}
	authenticatedServerID, err := agentsignals.ValidateAgentToken(e.App, token)
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
	items := make([]agentsignals.RuntimeStatusItem, 0, len(body.Items))
	for _, item := range body.Items {
		observedAt := reportedAt
		if strings.TrimSpace(item.ObservedAt) != "" {
			observedAt, err = time.Parse(time.RFC3339, item.ObservedAt)
			if err != nil {
				return e.BadRequestError("observedAt must be RFC3339", err)
			}
		}
		apps := make([]agentsignals.RuntimeAppStatus, 0, len(item.Apps))
		for _, appItem := range item.Apps {
			apps = append(apps, agentsignals.RuntimeAppStatus{
				AppID:        strings.TrimSpace(appItem.AppID),
				RuntimeState: strings.TrimSpace(appItem.RuntimeState),
			})
		}
		items = append(items, agentsignals.RuntimeStatusItem{
			TargetType:   strings.TrimSpace(item.TargetType),
			TargetID:     strings.TrimSpace(item.TargetID),
			RuntimeState: strings.TrimSpace(item.RuntimeState),
			ObservedAt:   observedAt,
			Containers: agentsignals.RuntimeContainerSummary{
				Running:    item.Containers.Running,
				Restarting: item.Containers.Restarting,
				Exited:     item.Containers.Exited,
			},
			Apps: apps,
		})
	}
	accepted, err := agentsignals.IngestRuntimeStatus(e.App, agentsignals.RuntimeStatusIngest{
		ServerID:   body.ServerID,
		ServerName: server.GetString("name"),
		ReportedAt: reportedAt,
		Items:      items,
	})
	if err != nil {
		if err == agentsignals.ErrRuntimeStatusTargetMismatch {
			return e.BadRequestError(err.Error(), nil)
		}
		return e.InternalServerError("failed to persist runtime summary", err)
	}
	return e.JSON(http.StatusAccepted, map[string]any{"ok": true, "accepted": accepted})
}

func handleMonitorAgentToken(e *core.RequestEvent) error {
	server, err := findMonitorServer(e.App, e.Request.PathValue("id"))
	if err != nil {
		return e.NotFoundError("server not found", err)
	}
	rotate := strings.EqualFold(strings.TrimSpace(e.Request.URL.Query().Get("rotate")), "true")
	token, changed, err := agentsignals.GetOrIssueAgentToken(e.App, server.Id, rotate)
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
	token, _, err := agentsignals.GetOrIssueAgentToken(e.App, server.Id, false)
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
	authenticatedServerID, err := agentsignals.ValidateAgentToken(e.App, token)
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
	items := make([]agentsignals.HeartbeatItem, 0, len(body.Items))
	for _, item := range body.Items {
		observedAt := reportedAt
		if strings.TrimSpace(item.ObservedAt) != "" {
			observedAt, err = time.Parse(time.RFC3339, item.ObservedAt)
			if err != nil {
				return e.BadRequestError("observedAt must be RFC3339", err)
			}
		}
		items = append(items, agentsignals.HeartbeatItem{
			TargetType: strings.TrimSpace(item.TargetType),
			TargetID:   strings.TrimSpace(item.TargetID),
			ObservedAt: observedAt,
		})
	}
	accepted, err := agentsignals.IngestHeartbeat(e.App, agentsignals.HeartbeatIngest{
		ServerID:     body.ServerID,
		ServerName:   server.GetString("name"),
		AgentVersion: body.AgentVersion,
		ReportedAt:   reportedAt,
		ReceivedAt:   time.Now().UTC(),
		Items:        items,
	})
	if err != nil {
		switch err {
		case agentsignals.ErrHeartbeatTargetTypeUnsupported, agentsignals.ErrHeartbeatTargetMismatch:
			return e.BadRequestError(err.Error(), nil)
		default:
			return e.InternalServerError("failed to persist latest status", err)
		}
	}
	return e.JSON(http.StatusAccepted, map[string]any{"ok": true, "accepted": accepted})
}

func handleMonitorOverview(e *core.RequestEvent) error {
	overview, err := monitorstatus.BuildOverview(e.App)
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
	startAt, err := parseMonitorSeriesTimeParam(e.Request.URL.Query().Get("startAt"))
	if err != nil {
		return e.BadRequestError("invalid startAt", err)
	}
	endAt, err := parseMonitorSeriesTimeParam(e.Request.URL.Query().Get("endAt"))
	if err != nil {
		return e.BadRequestError("invalid endAt", err)
	}
	options := monitormetrics.MetricSeriesQueryOptions{
		NetworkInterface: strings.TrimSpace(e.Request.URL.Query().Get("networkInterface")),
		StartAt:          startAt,
		EndAt:            endAt,
	}
	requestedSeries := []string{}
	if raw := strings.TrimSpace(e.Request.URL.Query().Get("series")); raw != "" {
		requestedSeries = append(requestedSeries, raw)
	}
	response, err := monitormetrics.QueryMetricSeries(
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

func parseMonitorSeriesTimeParam(value string) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func handleMonitorTargetStatus(e *core.RequestEvent) error {
	response, err := monitorstatus.GetTargetStatus(
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
