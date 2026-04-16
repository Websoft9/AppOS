package monitor

import (
	"crypto/rand"
	"database/sql"
	"encoding/base32"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/infra/collections"
)

var tokenEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

func GenerateAgentToken() string {
	b := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		panic("monitor: failed to read random bytes: " + err.Error())
	}
	return tokenEncoding.EncodeToString(b)
}

func AgentTokenSecretName(serverID string) string {
	return AgentTokenSecretPrefix + strings.TrimSpace(serverID)
}

func GetOrIssueAgentToken(app core.App, serverID string, rotate bool) (token string, changed bool, err error) {
	name := AgentTokenSecretName(serverID)
	secret, err := secrets.FindSystemSecretByNameAndType(app, name, AgentTokenSecretType)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", false, err
	}
	if errors.Is(err, sql.ErrNoRows) {
		secret = nil
	}
	if secret != nil && !rotate {
		token, err = secrets.ReadSystemSingleValue(secret)
		return token, false, err
	}

	plaintext := GenerateAgentToken()
	_, err = secrets.UpsertSystemSingleValue(app, secret, name, AgentTokenSecretType, plaintext)
	if err != nil {
		return "", false, err
	}
	return plaintext, true, nil
}

func ValidateAgentToken(app core.App, plaintext string) (string, error) {
	if strings.TrimSpace(plaintext) == "" {
		return "", fmt.Errorf("missing token")
	}
	records, err := app.FindRecordsByFilter(
		"secrets",
		"created_source = {:source} && template_id = {:template} && type = {:type}",
		"",
		500,
		0,
		map[string]any{
			"source":   secrets.CreatedSourceSystem,
			"template": secrets.TemplateSingleValue,
			"type":     AgentTokenSecretType,
		},
	)
	if err != nil {
		return "", err
	}
	for _, record := range records {
		secret := secrets.From(record)
		value, readErr := secrets.ReadSystemSingleValue(secret)
		if readErr != nil {
			return "", readErr
		}
		if value == plaintext {
			name := strings.TrimSpace(record.GetString("name"))
			if !strings.HasPrefix(name, AgentTokenSecretPrefix) {
				return "", fmt.Errorf("invalid monitor token secret naming")
			}
			serverID := strings.TrimPrefix(name, AgentTokenSecretPrefix)
			if serverID == "" {
				return "", fmt.Errorf("invalid monitor token secret naming")
			}
			return serverID, nil
		}
	}
	return "", fmt.Errorf("invalid token")
}

func EvaluateHeartbeat(observedAt, now time.Time) HeartbeatProjection {
	serverEntry, ok, err := ResolveTargetRegistryEntry(TargetTypeServer, "", "")
	if err != nil || !ok {
		serverEntry = TargetRegistryEntry{}
	}
	age := now.Sub(observedAt)
	if age < 0 {
		age = 0
	}
	switch {
	case age > OfflineHeartbeatThreshold:
		return HeartbeatProjection{
			Status:         serverEntry.HeartbeatStatusFor(HeartbeatStateOffline),
			Reason:         serverEntry.HeartbeatReasonFor(HeartbeatStateOffline, ""),
			ReasonCode:     serverEntry.HeartbeatReasonCodeFor(HeartbeatStateOffline, ""),
			HeartbeatState: HeartbeatStateOffline,
			ObservedAt:     observedAt,
		}
	case age > StaleHeartbeatThreshold:
		return HeartbeatProjection{
			Status:         serverEntry.HeartbeatStatusFor(HeartbeatStateStale),
			Reason:         serverEntry.HeartbeatReasonFor(HeartbeatStateStale, ""),
			ReasonCode:     serverEntry.HeartbeatReasonCodeFor(HeartbeatStateStale, ""),
			HeartbeatState: HeartbeatStateStale,
			ObservedAt:     observedAt,
		}
	default:
		return HeartbeatProjection{
			Status:         serverEntry.HeartbeatStatusFor(HeartbeatStateFresh),
			Reason:         "",
			ReasonCode:     serverEntry.HeartbeatReasonCodeFor(HeartbeatStateFresh, ""),
			HeartbeatState: HeartbeatStateFresh,
			ObservedAt:     observedAt,
		}
	}
}

func UpsertLatestStatus(app core.App, input LatestStatusUpsert) (*core.Record, error) {
	col, err := app.FindCollectionByNameOrId(collections.MonitorLatestStatus)
	if err != nil {
		return nil, err
	}

	record, err := app.FindFirstRecordByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": input.TargetType, "targetID": input.TargetID},
	)
	if err != nil {
		record = core.NewRecord(col)
	}

	existingStatus := record.GetString("status")
	if input.PreserveStrongerFailure && isStrongerFailure(existingStatus, input.Status, input.StatusPriorityMap) {
		input.Status = existingStatus
		input.Reason = record.GetString("reason")
	}

	lastTransitionAt := input.LastTransitionAt
	if existingStatus != "" && existingStatus == input.Status {
		if value := record.GetDateTime("last_transition_at"); !value.IsZero() {
			lastTransitionAt = value.Time()
		}
	}

	record.Set("target_type", input.TargetType)
	record.Set("target_id", input.TargetID)
	record.Set("display_name", input.DisplayName)
	record.Set("status", input.Status)
	record.Set("reason", input.Reason)
	record.Set("signal_source", input.SignalSource)
	record.Set("last_transition_at", lastTransitionAt.UTC().Format(time.RFC3339))
	if input.LastSuccessAt != nil {
		record.Set("last_success_at", input.LastSuccessAt.UTC().Format(time.RFC3339))
	}
	if input.LastFailureAt != nil {
		record.Set("last_failure_at", input.LastFailureAt.UTC().Format(time.RFC3339))
	}
	if input.LastCheckedAt != nil {
		record.Set("last_checked_at", input.LastCheckedAt.UTC().Format(time.RFC3339))
	}
	if input.LastReportedAt != nil {
		record.Set("last_reported_at", input.LastReportedAt.UTC().Format(time.RFC3339))
	}
	if input.ConsecutiveFailures != nil {
		record.Set("consecutive_failures", *input.ConsecutiveFailures)
	}
	if input.Summary != nil {
		record.Set("summary_json", input.Summary)
	}

	if err := app.Save(record); err != nil {
		return nil, err
	}
	return record, nil
}

func RefreshHeartbeatFreshness(app core.App, now time.Time) error {
	serverEntry, ok, err := ResolveTargetRegistryEntry(TargetTypeServer, "", "")
	if err != nil || !ok {
		serverEntry = TargetRegistryEntry{}
	}
	records, err := app.FindRecordsByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && signal_source = {:signalSource}",
		"",
		500,
		0,
		map[string]any{"targetType": TargetTypeServer, "signalSource": SignalSourceAgent},
	)
	if err != nil {
		return err
	}
	for _, record := range records {
		value := record.GetDateTime("last_reported_at")
		if value.IsZero() {
			continue
		}
		observedAt := value.Time()
		projection := EvaluateHeartbeat(observedAt, now)
		if isStrongerFailure(record.GetString("status"), projection.Status, serverEntry.StatusPriority) {
			continue
		}
		summary, _ := summaryFromAny(record.Get("summary_json"))
		if summary == nil {
			summary = map[string]any{}
		}
		summary["heartbeat_state"] = projection.HeartbeatState
		ApplyReasonCode(summary, projection.ReasonCode)

		failures := record.GetInt("consecutive_failures")
		lastFailureAt := (*time.Time)(nil)
		lastSuccessAt := (*time.Time)(nil)
		if projection.Status == StatusHealthy {
			failures = 0
			lastSuccessAt = &observedAt
		} else {
			failures++
			nowUTC := now.UTC()
			lastFailureAt = &nowUTC
		}
		_, err = UpsertLatestStatus(app, LatestStatusUpsert{
			TargetType:              record.GetString("target_type"),
			TargetID:                record.GetString("target_id"),
			DisplayName:             record.GetString("display_name"),
			Status:                  projection.Status,
			Reason:                  projection.Reason,
			SignalSource:            record.GetString("signal_source"),
			LastTransitionAt:        now,
			LastSuccessAt:           lastSuccessAt,
			LastFailureAt:           lastFailureAt,
			LastReportedAt:          &observedAt,
			ConsecutiveFailures:     &failures,
			Summary:                 summary,
			StatusPriorityMap:       serverEntry.StatusPriority,
			PreserveStrongerFailure: true,
		})
		if err != nil {
			return err
		}
	}
	return nil
}

func BuildOverview(app core.App) (*OverviewResponse, error) {
	records, err := app.FindRecordsByFilter(collections.MonitorLatestStatus, "", "-updated", 500, 0)
	if err != nil {
		return nil, err
	}
	counts := map[string]int{
		StatusHealthy:           0,
		StatusDegraded:          0,
		StatusOffline:           0,
		StatusUnreachable:       0,
		StatusCredentialInvalid: 0,
		StatusUnknown:           0,
	}
	resp := &OverviewResponse{Counts: counts}
	for _, record := range records {
		status := record.GetString("status")
		if _, ok := counts[status]; ok {
			counts[status]++
		}
		item := OverviewItem{
			TargetType:       record.GetString("target_type"),
			TargetID:         record.GetString("target_id"),
			DisplayName:      record.GetString("display_name"),
			Status:           status,
			Reason:           nullableString(record.GetString("reason")),
			LastTransitionAt: record.GetDateTime("last_transition_at").String(),
			DetailHref:       detailHref(record.GetString("target_type"), record.GetString("target_id")),
			Summary:          mustSummaryFromAny(record.Get("summary_json")),
		}
		if record.GetString("target_type") == TargetTypePlatform {
			resp.PlatformItems = append(resp.PlatformItems, item)
			continue
		}
		if status != StatusHealthy {
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
			case TargetTypeServer:
				return synthesizeServerTargetStatus(app, targetID)
			case TargetTypeApp:
				return synthesizeAppTargetStatus(app, targetID)
			}
		}
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
		Summary:             mustSummaryFromAny(record.Get("summary_json")),
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
	_, secretErr := secrets.FindSystemSecretByNameAndType(app, AgentTokenSecretName(targetID), AgentTokenSecretType)
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
		TargetType:          TargetTypeServer,
		TargetID:            targetID,
		DisplayName:         server.GetString("name"),
		Status:              StatusUnknown,
		Reason:              reason,
		SignalSource:        SignalSourceInventory,
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
	appEntry := ResolveAppBaselineTarget()
	outcome := AppHealthOutcomeFromRuntimeState(runtimeStatus)
	status := appEntry.AppHealthStatusFor(outcome)
	reason := appEntry.AppHealthReasonFor(outcome, healthSummary)
	transitionAt := appRecord.GetDateTime("updated").String()
	if strings.TrimSpace(transitionAt) == "" {
		transitionAt = appRecord.GetDateTime("created").String()
	}
	return &TargetStatusResponse{
		HasData:             false,
		TargetType:          TargetTypeApp,
		TargetID:            targetID,
		DisplayName:         appRecord.GetString("name"),
		Status:              status,
		Reason:              nullableString(reason),
		SignalSource:        SignalSourceInventory,
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

func summaryFromAny(value any) (map[string]any, error) {
	if value == nil {
		return nil, nil
	}
	if summary, ok := value.(map[string]any); ok {
		return summary, nil
	}
	var raw []byte
	switch typed := value.(type) {
	case []byte:
		raw = typed
	case string:
		raw = []byte(typed)
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return nil, err
		}
		raw = encoded
	}
	var summary map[string]any
	if err := json.Unmarshal(raw, &summary); err != nil {
		return nil, err
	}
	return summary, nil
}

func mustSummaryFromAny(value any) map[string]any {
	summary, err := summaryFromAny(value)
	if err != nil || summary == nil {
		return nil
	}
	return summary
}

func CloneSummary(summary map[string]any) map[string]any {
	if len(summary) == 0 {
		return map[string]any{}
	}
	cloned := make(map[string]any, len(summary))
	for key, value := range summary {
		cloned[key] = value
	}
	return cloned
}

func ApplyReasonCode(summary map[string]any, reasonCode string) {
	if summary == nil {
		return
	}
	trimmed := strings.TrimSpace(strings.ToLower(reasonCode))
	if trimmed == "" {
		delete(summary, "reason_code")
		return
	}
	summary["reason_code"] = trimmed
}

func LoadExistingSummary(app core.App, targetType, targetID string) map[string]any {
	record, err := app.FindFirstRecordByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": strings.TrimSpace(targetType), "targetID": strings.TrimSpace(targetID)},
	)
	if err != nil {
		return map[string]any{}
	}
	return CloneSummary(mustSummaryFromAny(record.Get("summary_json")))
}

func SummaryFromRecord(record *core.Record) (map[string]any, error) {
	if record == nil {
		return map[string]any{}, nil
	}
	summary, err := summaryFromAny(record.Get("summary_json"))
	if err != nil {
		return nil, err
	}
	return CloneSummary(summary), nil
}

func isStrongerFailure(existingStatus, nextStatus string, priorityMap map[string]int) bool {
	return statusPriorityWithMap(existingStatus, priorityMap) > statusPriorityWithMap(nextStatus, priorityMap)
}

func statusPriorityWithMap(status string, priorityMap map[string]int) int {
	status = strings.TrimSpace(strings.ToLower(status))
	if priorityMap != nil {
		if value, ok := priorityMap[status]; ok {
			return value
		}
	}
	switch status {
	case StatusCredentialInvalid:
		return 5
	case StatusUnreachable:
		return 4
	case StatusDegraded:
		return 3
	case StatusOffline:
		return 2
	case StatusUnknown:
		return 1
	default:
		return 0
	}
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
	case TargetTypeServer:
		return "/servers/" + targetID
	case TargetTypeApp:
		return "/apps/" + targetID
	case TargetTypeResource:
		return "/resources/" + targetID
	case TargetTypePlatform:
		return "/system/status"
	default:
		return ""
	}
}
