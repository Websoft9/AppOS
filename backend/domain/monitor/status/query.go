package status

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/monitor/persistence"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/infra/collections"
)

func BuildOverview(app core.App) (*OverviewResponse, error) {
	records, err := app.FindRecordsByFilter(collections.MonitorLatestStatus, "", "-updated", 500, 0)
	if err != nil {
		return nil, err
	}
	counts := map[string]int{
		monitor.StatusHealthy:           0,
		monitor.StatusDegraded:          0,
		monitor.StatusOffline:           0,
		monitor.StatusUnreachable:       0,
		monitor.StatusCredentialInvalid: 0,
		monitor.StatusUnknown:           0,
	}
	resp := &OverviewResponse{Counts: counts}
	for _, record := range records {
		status := record.GetString("status")
		if _, ok := counts[status]; ok {
			counts[status]++
		}
		summary, err := persistence.SummaryFromRecord(record)
		if err != nil {
			return nil, err
		}
		item := OverviewItem{
			TargetType:       record.GetString("target_type"),
			TargetID:         record.GetString("target_id"),
			DisplayName:      record.GetString("display_name"),
			Status:           status,
			Reason:           nullableString(record.GetString("reason")),
			LastTransitionAt: record.GetDateTime("last_transition_at").String(),
			DetailHref:       detailHref(record.GetString("target_type"), record.GetString("target_id")),
			Summary:          normalizeSummary(summary),
		}
		if record.GetString("target_type") == monitor.TargetTypePlatform {
			resp.PlatformItems = append(resp.PlatformItems, item)
			continue
		}
		if status != monitor.StatusHealthy {
			resp.UnhealthyItems = append(resp.UnhealthyItems, item)
		}
	}
	return resp, nil
}

func GetTargetStatus(app core.App, targetType, targetID string) (*TargetStatusResponse, error) {
	targetType = strings.TrimSpace(targetType)
	targetID = strings.TrimSpace(targetID)
	record, err := app.FindFirstRecordByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": targetType, "targetID": targetID},
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			switch targetType {
			case monitor.TargetTypeServer:
				return synthesizeServerTargetStatus(app, targetID)
			case monitor.TargetTypeApp:
				return synthesizeAppTargetStatus(app, targetID)
			}
		}
		return nil, err
	}
	summary, err := persistence.SummaryFromRecord(record)
	if err != nil {
		return nil, err
	}
	return &TargetStatusResponse{
		HasData:             true,
		TargetType:          record.GetString("target_type"),
		TargetID:            record.GetString("target_id"),
		DisplayName:         record.GetString("display_name"),
		Status:              record.GetString("status"),
		Reason:              nullableString(record.GetString("reason")),
		SignalSource:        record.GetString("signal_source"),
		LastTransitionAt:    record.GetDateTime("last_transition_at").String(),
		LastSuccessAt:       nullableTime(record.GetDateTime("last_success_at").String()),
		LastFailureAt:       nullableTime(record.GetDateTime("last_failure_at").String()),
		LastCheckedAt:       nullableTime(record.GetDateTime("last_checked_at").String()),
		LastReportedAt:      nullableTime(record.GetDateTime("last_reported_at").String()),
		ConsecutiveFailures: record.GetInt("consecutive_failures"),
		Summary:             normalizeSummary(summary),
	}, nil
}

func synthesizeServerTargetStatus(app core.App, targetID string) (*TargetStatusResponse, error) {
	server, err := app.FindRecordById("servers", targetID)
	if err != nil {
		return nil, err
	}

	connectedByTunnel := strings.EqualFold(strings.TrimSpace(server.GetString("connect_type")), "tunnel")
	connectivityStatus := "unknown"
	if connectedByTunnel {
		tunnelStatus := strings.ToLower(strings.TrimSpace(server.GetString("tunnel_status")))
		if tunnelStatus == "online" || tunnelStatus == "offline" {
			connectivityStatus = tunnelStatus
		}
	}

	hasAgentToken := false
	_, secretErr := secrets.FindSystemSecretByNameAndType(app, monitor.AgentTokenSecretPrefix+strings.TrimSpace(targetID), monitor.AgentTokenSecretType)
	if secretErr == nil {
		hasAgentToken = true
	} else if !errors.Is(secretErr, sql.ErrNoRows) {
		return nil, secretErr
	}

	transitionAt := server.GetDateTime("updated").String()
	if strings.TrimSpace(transitionAt) == "" {
		transitionAt = server.GetDateTime("created").String()
	}

	reason := "monitor agent has not reported yet"
	if hasAgentToken {
		reason = "monitor agent token is ready, waiting for first heartbeat"
	}

	return &TargetStatusResponse{
		HasData:             false,
		TargetType:          monitor.TargetTypeServer,
		TargetID:            targetID,
		DisplayName:         server.GetString("name"),
		Status:              monitor.StatusUnknown,
		Reason:              reason,
		SignalSource:        monitor.SignalSourceInventory,
		LastTransitionAt:    transitionAt,
		LastSuccessAt:       nil,
		LastFailureAt:       nil,
		LastCheckedAt:       nil,
		LastReportedAt:      nil,
		ConsecutiveFailures: 0,
		Summary: map[string]any{
			"monitoring_state":       map[bool]string{true: "awaiting_first_heartbeat", false: "agent_not_configured"}[hasAgentToken],
			"agent_token_configured": hasAgentToken,
			"connection_type":        strings.TrimSpace(server.GetString("connect_type")),
			"connectivity_status":    connectivityStatus,
			"host":                   strings.TrimSpace(server.GetString("host")),
			"port":                   server.GetInt("port"),
			"user":                   strings.TrimSpace(server.GetString("user")),
		},
	}, nil
}

func synthesizeAppTargetStatus(app core.App, targetID string) (*TargetStatusResponse, error) {
	appRecord, err := app.FindRecordById("app_instances", targetID)
	if err != nil {
		return nil, err
	}
	runtimeStatus := strings.ToLower(strings.TrimSpace(appRecord.GetString("runtime_status")))
	lifecycleState := strings.TrimSpace(appRecord.GetString("lifecycle_state"))
	healthSummary := strings.TrimSpace(appRecord.GetString("health_summary"))
	if runtimeStatus == "" {
		switch {
		case strings.HasPrefix(strings.ToLower(lifecycleState), "running"):
			runtimeStatus = "running"
		case strings.Contains(strings.ToLower(lifecycleState), "stopped"):
			runtimeStatus = "stopped"
		case strings.Contains(strings.ToLower(lifecycleState), "failed") || strings.Contains(strings.ToLower(lifecycleState), "error"):
			runtimeStatus = "error"
		}
	}
	appEntry := monitor.ResolveAppBaselineTarget()
	outcome := monitor.AppHealthOutcomeFromRuntimeState(runtimeStatus)
	status := appEntry.AppHealthStatusFor(outcome)
	reason := appEntry.AppHealthReasonFor(outcome, healthSummary)
	transitionAt := appRecord.GetDateTime("updated").String()
	if strings.TrimSpace(transitionAt) == "" {
		transitionAt = appRecord.GetDateTime("created").String()
	}
	return &TargetStatusResponse{
		HasData:             false,
		TargetType:          monitor.TargetTypeApp,
		TargetID:            targetID,
		DisplayName:         appRecord.GetString("name"),
		Status:              status,
		Reason:              nullableString(reason),
		SignalSource:        monitor.SignalSourceInventory,
		LastTransitionAt:    transitionAt,
		LastSuccessAt:       nil,
		LastFailureAt:       nil,
		LastCheckedAt:       nil,
		LastReportedAt:      nil,
		ConsecutiveFailures: 0,
		Summary: map[string]any{
			"monitoring_state":    "awaiting_runtime_projection",
			"reason_code":         appEntry.AppHealthReasonCodeFor(outcome, ""),
			"runtime_status":      runtimeStatus,
			"lifecycle_state":     lifecycleState,
			"health_summary":      healthSummary,
			"publication_summary": strings.TrimSpace(appRecord.GetString("publication_summary")),
			"server_id":           strings.TrimSpace(appRecord.GetString("server_id")),
		},
	}, nil
}

func normalizeSummary(summary map[string]any) map[string]any {
	if len(summary) == 0 {
		return nil
	}
	return summary
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nullableTime(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func detailHref(targetType, targetID string) string {
	switch targetType {
	case monitor.TargetTypeServer:
		return "/servers/" + targetID
	case monitor.TargetTypeApp:
		return "/apps/" + targetID
	case monitor.TargetTypeResource:
		return "/resources/" + targetID
	case monitor.TargetTypePlatform:
		return "/system/status"
	default:
		return ""
	}
}

type OverviewItem struct {
	TargetType       string         `json:"targetType,omitempty"`
	TargetID         string         `json:"targetId"`
	DisplayName      string         `json:"displayName"`
	Status           string         `json:"status"`
	Reason           any            `json:"reason"`
	LastTransitionAt string         `json:"lastTransitionAt"`
	DetailHref       string         `json:"detailHref,omitempty"`
	Summary          map[string]any `json:"summary,omitempty"`
}

type OverviewResponse struct {
	Counts         map[string]int `json:"counts"`
	UnhealthyItems []OverviewItem `json:"unhealthyItems"`
	PlatformItems  []OverviewItem `json:"platformItems"`
}

type TargetStatusResponse struct {
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
