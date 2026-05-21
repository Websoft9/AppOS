package routes

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	monitormetrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
	monitorstatus "github.com/websoft9/appos/backend/domain/monitor/status"
)

const maxMonitorWriteBodyBytes int64 = 100 << 20

var errMonitorWritePayloadTooLarge = errors.New("monitor write payload too large")

// monitorWriteHTTPClient is reused across all monitor write requests to enable
// TCP connection pooling to the local time-series database.
var monitorWriteHTTPClient = &http.Client{Timeout: 30 * time.Second}

func registerMonitorRoutes(se *core.ServeEvent) {
	se.Router.POST("/api/monitor/write", handleMonitorWrite)
	se.Router.POST("/api/monitor/telegraf/write", handleMonitorTelegrafWrite)

	monitorGroup := se.Router.Group("/api/monitor")
	monitorGroup.Bind(apis.RequireAuth())
	monitorGroup.GET("/overview", handleMonitorOverview)
	monitorGroup.GET("/servers/{id}/container-telemetry", handleMonitorServerContainerTelemetry)
	monitorGroup.GET("/targets/{targetType}/{targetId}", handleMonitorTargetStatus)
	monitorGroup.GET("/targets/{targetType}/{targetId}/series", handleMonitorTargetSeries)

}

// @Summary Write Netdata metrics
// @Description Receives Prometheus remote-write protobuf payloads from managed-server Netdata agents. This endpoint is served by the AppOS backend and forwards accepted payloads to the embedded time-series database. Authenticate with HTTP Basic Auth where username is the server record ID and password is the per-server monitor agent token issued during Netdata install/update. Reverse-proxy forwarding headers used elsewhere for agent URL generation are parsed defensively: only the first comma-separated host/port value is used and forwarded ports must be numeric.
// @Tags Monitoring Ingest
// @Param Authorization header string true "Basic base64(serverId:monitorAgentToken)"
// @Param Content-Type header string true "application/x-protobuf"
// @Param Content-Encoding header string false "remote-write compression, usually snappy"
// @Param X-Prometheus-Remote-Write-Version header string false "Prometheus remote-write protocol version"
// @Accept application/x-protobuf
// @Success 204 {object} nil
// @Failure 401 {object} MonitorErrorResponse
// @Failure 413 {object} MonitorErrorResponse
// @Failure 502 {object} MonitorErrorResponse
// @Router /api/monitor/write [post]
func handleMonitorWrite(e *core.RequestEvent) error {
	serverID, token, ok := e.Request.BasicAuth()
	serverID = strings.TrimSpace(serverID)
	if !ok || serverID == "" || strings.TrimSpace(token) == "" {
		return monitorWriteUnauthorized(e)
	}
	if _, err := findMonitorServer(e.App, serverID); err != nil {
		return monitorWriteUnauthorized(e)
	}
	expectedToken, err := readMonitorAgentToken(e.App, serverID)
	if err != nil || !constantTimeTokenEqual(expectedToken, token) {
		return monitorWriteUnauthorized(e)
	}
	if e.Request.ContentLength > maxMonitorWriteBodyBytes {
		return monitorWritePayloadTooLarge(e)
	}

	if _, err := monitorWriteEndpoint(); err != nil {
		return e.JSON(http.StatusBadGateway, map[string]any{"error": "tsdb_unavailable", "message": err.Error()})
	}
	limitedBody := &monitorWriteLimitReadCloser{body: e.Request.Body, remaining: maxMonitorWriteBodyBytes}
	defer limitedBody.Close()
	payload, err := io.ReadAll(limitedBody)
	if err != nil {
		if errors.Is(err, errMonitorWritePayloadTooLarge) {
			return monitorWritePayloadTooLarge(e)
		}
		return e.JSON(http.StatusBadGateway, map[string]any{"error": "tsdb_read_failed", "message": err.Error()})
	}
	points, projectionErr := projectRemoteWriteMetricPoints(payload, e.Request.Header.Get("Content-Encoding"), serverID)
	if projectionErr != nil {
		slog.Warn(describeRemoteWriteProjectionError(projectionErr), "server_id", serverID)
	}
	if len(points) > 0 {
		if err := monitormetrics.WriteMetricPoints(e.Request.Context(), points); err != nil {
			slog.Warn("remote write canonical metric write failed", "server_id", serverID, "error", err)
		}
	}
	return e.NoContent(http.StatusNoContent)
}

// @Summary Write Telegraf metrics
// @Description Receives Influx line protocol payloads from managed-server Telegraf agents and forwards them to the embedded VictoriaMetrics Influx write endpoint. Authenticate with HTTP Basic Auth where username is the server record ID and password is the per-server monitor agent token issued during managed metrics collector setup.
// @Tags Monitoring Ingest
// @Param Authorization header string true "Basic base64(serverId:monitorAgentToken)"
// @Accept text/plain
// @Success 204 {object} nil
// @Failure 401 {object} MonitorErrorResponse
// @Failure 413 {object} MonitorErrorResponse
// @Failure 502 {object} MonitorErrorResponse
// @Router /api/monitor/telegraf/write [post]
func handleMonitorTelegrafWrite(e *core.RequestEvent) error {
	serverID, token, ok := e.Request.BasicAuth()
	serverID = strings.TrimSpace(serverID)
	if !ok || serverID == "" || strings.TrimSpace(token) == "" {
		return monitorWriteUnauthorized(e)
	}
	if _, err := findMonitorServer(e.App, serverID); err != nil {
		return monitorWriteUnauthorized(e)
	}
	expectedToken, err := readMonitorAgentToken(e.App, serverID)
	if err != nil || !constantTimeTokenEqual(expectedToken, token) {
		return monitorWriteUnauthorized(e)
	}
	if e.Request.ContentLength > maxMonitorWriteBodyBytes {
		return monitorWritePayloadTooLarge(e)
	}
	endpoint, err := monitorInfluxWriteEndpoint()
	if err != nil {
		return e.JSON(http.StatusBadGateway, map[string]any{"error": "tsdb_unavailable", "message": err.Error()})
	}
	limitedBody := &monitorWriteLimitReadCloser{body: e.Request.Body, remaining: maxMonitorWriteBodyBytes}
	defer limitedBody.Close()
	payload, err := io.ReadAll(limitedBody)
	if err != nil {
		if errors.Is(err, errMonitorWritePayloadTooLarge) {
			return monitorWritePayloadTooLarge(e)
		}
		return e.JSON(http.StatusBadGateway, map[string]any{"error": "tsdb_read_failed", "message": err.Error()})
	}
	req, err := http.NewRequestWithContext(e.Request.Context(), http.MethodPost, endpoint, strings.NewReader(string(payload)))
	if err != nil {
		return e.JSON(http.StatusBadGateway, map[string]any{"error": "tsdb_forward_failed", "message": err.Error()})
	}
	req.Header.Set("Content-Type", "text/plain; charset=utf-8")
	req.Header.Set("Stream-Mode", "1")
	resp, err := monitorWriteHTTPClient.Do(req)
	if err != nil {
		return e.JSON(http.StatusBadGateway, map[string]any{"error": "tsdb_forward_failed", "message": err.Error()})
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		message, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return e.JSON(http.StatusBadGateway, map[string]any{"error": "tsdb_forward_failed", "message": fmt.Sprintf("victoriametrics influx write failed with status %d: %s", resp.StatusCode, strings.TrimSpace(string(message)))})
	}
	return e.NoContent(http.StatusNoContent)
}

func monitorWriteUnauthorized(e *core.RequestEvent) error {
	e.Response.Header().Set("WWW-Authenticate", `Basic realm="AppOS monitor write"`)
	return e.JSON(http.StatusUnauthorized, map[string]any{"error": "invalid_monitor_agent_credentials"})
}

func monitorWritePayloadTooLarge(e *core.RequestEvent) error {
	return e.JSON(http.StatusRequestEntityTooLarge, map[string]any{"error": "monitor_write_payload_too_large", "maxBytes": maxMonitorWriteBodyBytes})
}

type monitorWriteLimitReadCloser struct {
	body      io.ReadCloser
	remaining int64
	exceeded  bool
}

func (r *monitorWriteLimitReadCloser) Read(p []byte) (int, error) {
	if r.exceeded {
		return 0, errMonitorWritePayloadTooLarge
	}
	if r.remaining <= 0 {
		buf := make([]byte, 1)
		n, err := r.body.Read(buf)
		if n > 0 {
			r.exceeded = true
			return 0, errMonitorWritePayloadTooLarge
		}
		return 0, err
	}
	if int64(len(p)) > r.remaining {
		p = p[:r.remaining]
	}
	n, err := r.body.Read(p)
	r.remaining -= int64(n)
	return n, err
}

func (r *monitorWriteLimitReadCloser) Close() error {
	return r.body.Close()
}

func monitorWriteEndpoint() (string, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv(monitormetrics.EnvVictoriaMetricsURL)), "/")
	if baseURL == "" {
		return "", fmt.Errorf("%s is not configured", monitormetrics.EnvVictoriaMetricsURL)
	}
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("%s must include scheme and host", monitormetrics.EnvVictoriaMetricsURL)
	}
	return baseURL + "/api/v1/write", nil
}

func monitorInfluxWriteEndpoint() (string, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv(monitormetrics.EnvVictoriaMetricsURL)), "/")
	if baseURL == "" {
		return "", fmt.Errorf("%s is not configured", monitormetrics.EnvVictoriaMetricsURL)
	}
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("%s must include scheme and host", monitormetrics.EnvVictoriaMetricsURL)
	}
	return baseURL + "/write", nil
}

type MonitorErrorResponse struct {
	Error    string `json:"error,omitempty"`
	Message  string `json:"message,omitempty"`
	MaxBytes int64  `json:"maxBytes,omitempty"`
}

type MonitorOverviewResponse struct {
	Counts         map[string]int        `json:"counts"`
	UnhealthyItems []MonitorOverviewItem `json:"unhealthyItems"`
	PlatformItems  []MonitorOverviewItem `json:"platformItems"`
}

type MonitorOverviewItem struct {
	TargetType       string         `json:"targetType,omitempty"`
	TargetID         string         `json:"targetId"`
	DisplayName      string         `json:"displayName"`
	Status           string         `json:"status"`
	Reason           any            `json:"reason"`
	LastTransitionAt string         `json:"lastTransitionAt"`
	DetailHref       string         `json:"detailHref,omitempty"`
	Summary          map[string]any `json:"summary,omitempty"`
}

type MonitorTargetStatusResponse struct {
	HasData             bool           `json:"hasData"`
	TargetType          string         `json:"targetType"`
	TargetID            string         `json:"targetId"`
	DisplayName         string         `json:"displayName"`
	Status              string         `json:"status"`
	Reason              any            `json:"reason"`
	SignalSource        string         `json:"signalSource"`
	LastTransitionAt    string         `json:"lastTransitionAt"`
	LastSuccessAt       any            `json:"lastSuccessAt"`
	LastFailureAt       any            `json:"lastFailureAt"`
	LastCheckedAt       any            `json:"lastCheckedAt"`
	LastReportedAt      any            `json:"lastReportedAt"`
	ConsecutiveFailures int            `json:"consecutiveFailures"`
	Summary             map[string]any `json:"summary,omitempty"`
}

// The following DTOs intentionally mirror monitormetrics response types so the
// OpenAPI generator emits full schemas for public monitor endpoints.
type MonitorMetricSeriesResponse struct {
	TargetType                 string                `json:"targetType"`
	TargetID                   string                `json:"targetId"`
	Window                     string                `json:"window"`
	RangeStartAt               string                `json:"rangeStartAt,omitempty"`
	RangeEndAt                 string                `json:"rangeEndAt,omitempty"`
	StepSeconds                int                   `json:"stepSeconds,omitempty"`
	Series                     []MonitorMetricSeries `json:"series"`
	AvailableNetworkInterfaces []string              `json:"availableNetworkInterfaces,omitempty"`
	SelectedNetworkInterface   string                `json:"selectedNetworkInterface,omitempty"`
}

type MonitorMetricSeries struct {
	Name     string                       `json:"name"`
	Unit     string                       `json:"unit"`
	Points   [][]float64                  `json:"points,omitempty"`
	Segments []MonitorMetricSeriesSegment `json:"segments,omitempty"`
	Metadata map[string]string            `json:"metadata,omitempty"`
}

type MonitorMetricSeriesSegment struct {
	Name   string      `json:"name"`
	Points [][]float64 `json:"points"`
}

type MonitorContainerTelemetryResponse struct {
	ServerID     string                          `json:"serverId"`
	Window       string                          `json:"window"`
	RangeStartAt string                          `json:"rangeStartAt,omitempty"`
	RangeEndAt   string                          `json:"rangeEndAt,omitempty"`
	StepSeconds  int                             `json:"stepSeconds,omitempty"`
	Items        []MonitorContainerTelemetryItem `json:"items"`
}

type MonitorContainerTelemetryItem struct {
	ContainerID    string                             `json:"containerId"`
	ContainerName  string                             `json:"containerName,omitempty"`
	ComposeProject string                             `json:"composeProject,omitempty"`
	ComposeService string                             `json:"composeService,omitempty"`
	Latest         MonitorContainerTelemetryLatest    `json:"latest"`
	Freshness      MonitorContainerTelemetryFreshness `json:"freshness"`
	Series         []MonitorMetricSeries              `json:"series,omitempty"`
}

type MonitorContainerTelemetryLatest struct {
	CPUPercent               *float64 `json:"cpuPercent,omitempty"`
	MemoryUsageBytes         *float64 `json:"memoryUsageBytes,omitempty"`
	MemoryLimitBytes         *float64 `json:"memoryLimitBytes,omitempty"`
	NetworkRxBytesPerSecond  *float64 `json:"networkRxBytesPerSecond,omitempty"`
	NetworkTxBytesPerSecond  *float64 `json:"networkTxBytesPerSecond,omitempty"`
	BlockReadBytesPerSecond  *float64 `json:"blockReadBytesPerSecond,omitempty"`
	BlockWriteBytesPerSecond *float64 `json:"blockWriteBytesPerSecond,omitempty"`
}

type MonitorContainerTelemetryFreshness struct {
	State      string `json:"state"`
	ObservedAt string `json:"observedAt,omitempty"`
}

// @Summary Get monitor overview
// @Description Returns aggregate status counts plus unhealthy targets and platform monitor items. Status values include healthy, degraded, offline, unreachable, credential_invalid, and unknown.
// @Tags Monitoring
// @Security BearerAuth
// @Success 200 {object} MonitorOverviewResponse
// @Failure 401 {object} MonitorErrorResponse
// @Failure 500 {object} MonitorErrorResponse
// @Router /api/monitor/overview [get]
func handleMonitorOverview(e *core.RequestEvent) error {
	overview, err := monitorstatus.BuildOverview(e.App)
	if err != nil {
		return e.InternalServerError("failed to build overview", err)
	}
	return e.JSON(http.StatusOK, overview)
}

// @Summary Get server container telemetry
// @Description Returns latest and time-series telemetry for containers on one managed server. For the current Netdata-backed MVP, AppOS matches telemetry primarily by normalized containerName; containerId remains a request correlation key and fallback when no name is provided.
// @Tags Monitoring
// @Security BearerAuth
// @Param id path string true "server record ID"
// @Param window query string false "fixed time window" Enums(1m,5m,15m,0.1h,0.5h,1h,5h,6h,12h,1d,24h,7d)
// @Param containerId query string false "request correlation key; repeat to request multiple containers"
// @Param containerName query string false "container name used as the primary telemetry identity; repeat in the same order as containerId"
// @Success 200 {object} MonitorContainerTelemetryResponse
// @Failure 400 {object} MonitorErrorResponse
// @Failure 401 {object} MonitorErrorResponse
// @Failure 404 {object} MonitorErrorResponse
// @Router /api/monitor/servers/{id}/container-telemetry [get]
func handleMonitorServerContainerTelemetry(e *core.RequestEvent) error {
	serverID := strings.TrimSpace(e.Request.PathValue("id"))
	if serverID == "" {
		return e.BadRequestError("server id is required", nil)
	}
	if _, err := findMonitorServer(e.App, serverID); err != nil {
		return e.NotFoundError("server not found", err)
	}
	window := strings.TrimSpace(e.Request.URL.Query().Get("window"))
	if window == "" {
		window = "15m"
	}
	containerIDs := e.Request.URL.Query()["containerId"]
	containerNames := e.Request.URL.Query()["containerName"]
	targets := make([]monitormetrics.ContainerTelemetryTarget, 0, len(containerIDs))
	for index, containerID := range containerIDs {
		target := monitormetrics.ContainerTelemetryTarget{ID: containerID}
		if index < len(containerNames) {
			target.Name = containerNames[index]
		}
		targets = append(targets, target)
	}
	response, err := monitormetrics.QueryContainerTelemetry(e.Request.Context(), serverID, targets, window)
	if err != nil {
		return e.BadRequestError("failed to query container telemetry", err)
	}
	return e.JSON(http.StatusOK, response)
}

// @Summary Get monitor target series
// @Description Returns metric series for a monitor target. targetType accepts server, app, container, or platform. series accepts cpu, memory, disk, disk_usage, network, or network_traffic depending on target type. Use startAt and endAt together for a custom RFC3339 range.
// @Tags Monitoring
// @Security BearerAuth
// @Param targetType path string true "monitor target type" Enums(server,app,container,platform)
// @Param targetId path string true "monitor target ID; platform uses appos-core for AppOS host metrics"
// @Param window query string false "fixed time window; ignored when startAt and endAt are both set" Enums(15m,1h,5h,6h,12h,1d,24h,7d)
// @Param series query string false "metric series alias" Enums(cpu,memory,disk,disk_usage,network,network_traffic)
// @Param networkInterface query string false "network interface for network series; use all or omit for aggregate"
// @Param startAt query string false "custom range start time in RFC3339 format"
// @Param endAt query string false "custom range end time in RFC3339 format"
// @Success 200 {object} MonitorMetricSeriesResponse
// @Failure 400 {object} MonitorErrorResponse
// @Failure 401 {object} MonitorErrorResponse
// @Router /api/monitor/targets/{targetType}/{targetId}/series [get]
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

// @Summary Get monitor target status
// @Description Returns the latest projected status for a monitor target. targetType accepts server, app, container, resource, or platform.
// @Tags Monitoring
// @Security BearerAuth
// @Param targetType path string true "monitor target type" Enums(server,app,container,resource,platform)
// @Param targetId path string true "monitor target ID"
// @Success 200 {object} MonitorTargetStatusResponse
// @Failure 401 {object} MonitorErrorResponse
// @Failure 404 {object} MonitorErrorResponse
// @Failure 500 {object} MonitorErrorResponse
// @Router /api/monitor/targets/{targetType}/{targetId} [get]
func handleMonitorTargetStatus(e *core.RequestEvent) error {
	response, err := monitorstatus.GetTargetStatus(
		e.App,
		e.Request.PathValue("targetType"),
		e.Request.PathValue("targetId"),
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return e.NotFoundError("monitor target not found", err)
		}
		return e.InternalServerError("failed to load monitor target status", err)
	}
	return e.JSON(http.StatusOK, response)
}

func findMonitorServer(app core.App, serverID string) (*core.Record, error) {
	return app.FindRecordById("servers", strings.TrimSpace(serverID))
}

func monitorBaseURL(e *core.RequestEvent) string {
	scheme := "http"
	if strings.EqualFold(strings.TrimSpace(e.Request.Header.Get("X-Forwarded-Proto")), "https") || e.Request.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + resolveMonitorHTTPHost(e)
}

// resolveMonitorHTTPHost builds the host portion of the remote-write URL returned
// to managed-server agents. It honours standard proxy forwarding headers. The
// resulting URL is validated by buildNetdataExportingConfig before use, and only
// operators with existing server-management access receive it.
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
