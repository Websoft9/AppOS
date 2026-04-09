package service

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"github.com/websoft9/appos/backend/domain/groups"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
)

func (s TunnelService) ConnectionLogs(serverID string) ([]map[string]any, error) {
	_, _, err := s.loadManagedServer(serverID)
	if err != nil {
		return nil, fmt.Errorf("load server %s: %w", serverID, err)
	}

	records, err := s.App.FindRecordsByFilter(
		CollectionAuditLogs,
		"resource_type = 'server' && resource_id = {:resourceId} && (action = {:connect} || action = {:disconnect} || action = {:pause} || action = {:resume} || action = {:rotate} || action = {:rejected})",
		"-created",
		200,
		0,
		dbx.Params{
			"resourceId": serverID,
			"connect":    ActionTunnelConnect,
			"disconnect": ActionTunnelDisconnect,
			"pause":      ActionTunnelPause,
			"resume":     ActionTunnelResume,
			"rotate":     ActionTunnelTokenRotated,
			"rejected":   ActionTunnelConnectRejected,
		},
	)
	if err != nil {
		return nil, fmt.Errorf("query connection logs for %s: %w", serverID, err)
	}

	type rawTunnelLog struct {
		record     *core.Record
		action     string
		createdAt  time.Time
		detail     map[string]any
		pauseUntil string
	}

	rawLogs := make([]rawTunnelLog, 0, len(records))
	resumeTimes := make([]time.Time, 0, len(records))
	connectCount := 0
	for _, record := range records {
		action := record.GetString("action")
		createdAt := recordTime(record, "created")
		detail := normalizeTunnelAuditDetail(record.Get("detail"))
		pauseUntil := stringFromAny(detail["pause_until"])
		rawLogs = append(rawLogs, rawTunnelLog{
			record:     record,
			action:     action,
			createdAt:  createdAt,
			detail:     detail,
			pauseUntil: pauseUntil,
		})
		if action == ActionTunnelResume {
			resumeTimes = append(resumeTimes, createdAt)
		}
		if action == ActionTunnelConnect {
			connectCount++
		}
	}

	items := make([]map[string]any, 0, len(records))
	remainingConnects := connectCount
	for _, entry := range rawLogs {
		action := entry.action
		createdAt := entry.createdAt
		detail := entry.detail
		pauseUntil := entry.pauseUntil
		minutes := floatFromAny(detail["minutes"])
		if action == ActionTunnelPause && minutes == 0 && pauseUntil != "" && !createdAt.IsZero() {
			if pauseUntilTime, err := time.Parse(time.RFC3339, pauseUntil); err == nil && pauseUntilTime.After(createdAt) {
				minutes = math.Round((pauseUntilTime.Sub(createdAt).Minutes())*10) / 10
			}
		}
		label := tunnelLogActionLabel(action)
		if action == ActionTunnelConnect {
			remainingConnects--
			if remainingConnects > 0 {
				label = "Reconnect"
			}
		}
		item := map[string]any{
			"id":           entry.record.Id,
			"at":           servers.FormatTunnelTime(createdAt),
			"action":       action,
			"label":        label,
			"reason":       stringFromAny(detail["reason"]),
			"reason_label": firstNonEmpty(stringFromAny(detail["reason_label"]), servers.TunnelDisconnectReasonLabel(stringFromAny(detail["reason"]))),
			"remote_addr":  stringFromAny(detail["remote_addr"]),
			"pause_until":  pauseUntil,
			"minutes":      minutes,
		}
		items = append(items, item)

		if action == ActionTunnelPause && pauseUntil != "" {
			pauseUntilTime, err := time.Parse(time.RFC3339, pauseUntil)
			if err != nil {
				continue
			}
			if pauseUntilTime.After(time.Now().UTC()) {
				continue
			}
			resumed := false
			for _, resumeAt := range resumeTimes {
				if resumeAt.After(createdAt) && !resumeAt.After(pauseUntilTime) {
					resumed = true
					break
				}
			}
			if resumed {
				continue
			}
			items = append(items, map[string]any{
				"id":           entry.record.Id + "-pause-expired",
				"at":           servers.FormatTunnelTime(pauseUntilTime),
				"action":       ActionTunnelPauseExpired,
				"label":        "Pause expired",
				"reason":       "pause_expired",
				"reason_label": "Pause window elapsed",
				"remote_addr":  "",
				"pause_until":  pauseUntil,
				"minutes":      minutes,
			})
		}
	}

	sort.SliceStable(items, func(i, j int) bool {
		return stringFromAny(items[i]["at"]) > stringFromAny(items[j]["at"])
	})
	return items, nil
}

func (s TunnelService) Overview() (TunnelOverviewResult, error) {
	serverRecords, err := s.App.FindRecordsByFilter(
		CollectionServers,
		"connect_type = 'tunnel'",
		"name", 0, 0,
	)
	if err != nil {
		return TunnelOverviewResult{}, fmt.Errorf("list tunnel servers: %w", err)
	}

	serverIDs := make([]string, 0, len(serverRecords))
	for _, rec := range serverRecords {
		serverIDs = append(serverIDs, rec.Id)
	}
	groupNames, _ := groups.LoadNamesForObjects(s.App, groups.ObjectTypeServer, serverIDs)

	// Batch-load reconnect info for all servers in one query (avoids N+1).
	reconnectInfoMap, _ := s.loadBatchReconnectInfo(serverIDs)

	summary := map[string]int{
		"total":                     len(serverRecords),
		"online":                    0,
		"offline":                   0,
		"waiting_for_first_connect": 0,
	}
	items := make([]map[string]any, 0, len(serverRecords))
	for _, rec := range serverRecords {
		ms := servers.ManagedServerFromRecord(rec)
		rt := servers.TunnelRuntimeFromRecord(rec)
		item := servers.BuildTunnelOverviewItem(ms, rt, groupNames[rec.Id], s.Sessions)
		if info, ok := reconnectInfoMap[rec.Id]; ok {
			for key, value := range info {
				item[key] = value
			}
		}
		status, _ := item["status"].(string)
		if status == "online" {
			summary["online"]++
		} else {
			summary["offline"]++
			if servers.TunnelRuntimeFromRecord(rec).WaitingForFirstConnect() {
				summary["waiting_for_first_connect"]++
			}
		}
		items = append(items, item)
	}

	return TunnelOverviewResult{Summary: summary, Items: items}, nil
}

func (s TunnelService) Session(record *core.Record) (map[string]any, error) {
	groupNames, _ := groups.LoadNamesForObjects(s.App, groups.ObjectTypeServer, []string{record.Id})
	ms := servers.ManagedServerFromRecord(record)
	rt := servers.TunnelRuntimeFromRecord(record)
	item := servers.BuildTunnelOverviewItem(ms, rt, groupNames[record.Id], s.Sessions)
	reconnectInfo, err := s.loadRecentTunnelReconnectInfo(record.Id)
	if err == nil {
		for key, value := range reconnectInfo {
			item[key] = value
		}
	}
	return item, nil
}

func (s TunnelService) loadRecentTunnelReconnectInfo(serverID string) (map[string]any, error) {
	windowStart := time.Now().UTC().Add(-24 * time.Hour)
	records, err := s.App.FindRecordsByFilter(
		CollectionAuditLogs,
		"action = {:action} && resource_type = 'server' && resource_id = {:resourceId} && created >= {:windowStart}",
		"-created",
		0,
		0,
		dbx.Params{"action": ActionTunnelConnect, "resourceId": serverID, "windowStart": windowStart.Format(time.RFC3339)},
	)
	if err != nil {
		return nil, fmt.Errorf("load reconnect info for %s: %w", serverID, err)
	}

	return buildReconnectInfo(records), nil
}

// loadBatchReconnectInfo fetches recent tunnel.connect events for all given
// server IDs in a single query, avoiding the N+1 pattern.
func (s TunnelService) loadBatchReconnectInfo(serverIDs []string) (map[string]map[string]any, error) {
	if len(serverIDs) == 0 {
		return nil, nil
	}

	windowStart := time.Now().UTC().Add(-24 * time.Hour)

	// Build dynamic IN clause: resource_id IN ({:id0}, {:id1}, ...)
	placeholders := make([]string, len(serverIDs))
	params := dbx.Params{
		"action":      ActionTunnelConnect,
		"windowStart": windowStart.Format(time.RFC3339),
	}
	for i, id := range serverIDs {
		key := fmt.Sprintf("id%d", i)
		placeholders[i] = fmt.Sprintf("{:%s}", key)
		params[key] = id
	}

	filter := fmt.Sprintf(
		"action = {:action} && resource_type = 'server' && resource_id IN (%s) && created >= {:windowStart}",
		strings.Join(placeholders, ", "),
	)

	records, err := s.App.FindRecordsByFilter(
		CollectionAuditLogs, filter, "-created", 0, 0, params,
	)
	if err != nil {
		return nil, fmt.Errorf("batch load reconnect info: %w", err)
	}

	// Group records by resource_id.
	grouped := make(map[string][]*core.Record, len(serverIDs))
	for _, rec := range records {
		rid := rec.GetString("resource_id")
		grouped[rid] = append(grouped[rid], rec)
	}

	result := make(map[string]map[string]any, len(serverIDs))
	for _, sid := range serverIDs {
		result[sid] = buildReconnectInfo(grouped[sid])
	}
	return result, nil
}

// buildReconnectInfo summarises a (pre-sorted, newest-first) slice of
// tunnel.connect audit records into the reconnect overview map.
func buildReconnectInfo(records []*core.Record) map[string]any {
	recentReconnects := make([]map[string]any, 0, 3)
	reconnectCount24h := len(records)
	for _, record := range records {
		if len(recentReconnects) >= 3 {
			break
		}
		created := recordTime(record, "created")
		detail := normalizeTunnelAuditDetail(record.Get("detail"))
		remoteAddr, _ := detail["remote_addr"].(string)
		recentReconnects = append(recentReconnects, map[string]any{
			"at":             servers.FormatTunnelTime(created),
			"remote_addr":    remoteAddr,
			"services_count": intFromAny(detail["services_count"]),
		})
	}

	lastReconnectAt := ""
	if len(recentReconnects) > 0 {
		if value, ok := recentReconnects[0]["at"].(string); ok {
			lastReconnectAt = value
		}
	}

	return map[string]any{
		"last_reconnect_at":          lastReconnectAt,
		"recent_reconnect_count_24h": reconnectCount24h,
		"recent_reconnects":          recentReconnects,
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

func recordTime(record *core.Record, field string) time.Time {
	value := record.GetDateTime(field)
	if value.IsZero() {
		return time.Time{}
	}
	return value.Time().UTC()
}

func tunnelLogActionLabel(action string) string {
	switch action {
	case ActionTunnelConnect:
		return "Connected"
	case ActionTunnelDisconnect:
		return "Disconnected"
	case ActionTunnelPause:
		return "Pause started"
	case ActionTunnelResume:
		return "Connect resumed"
	case ActionTunnelTokenRotated:
		return "Token rotated"
	case ActionTunnelConnectRejected:
		return "Rejected while paused"
	default:
		return action
	}
}

func stringFromAny(value any) string {
	switch raw := value.(type) {
	case string:
		return raw
	default:
		return ""
	}
}

func floatFromAny(value any) float64 {
	switch raw := value.(type) {
	case float64:
		return raw
	case float32:
		return float64(raw)
	case int:
		return float64(raw)
	case int64:
		return float64(raw)
	case string:
		parsed, err := strconv.ParseFloat(raw, 64)
		if err == nil {
			return parsed
		}
	default:
		return 0
	}
	return 0
}

func intFromAny(value any) int {
	switch raw := value.(type) {
	case int:
		return raw
	case int32:
		return int(raw)
	case int64:
		return int(raw)
	case float64:
		return int(raw)
	default:
		return 0
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func normalizeTunnelAuditDetail(value any) map[string]any {
	switch detail := value.(type) {
	case map[string]any:
		return detail
	case []byte:
		if len(detail) == 0 {
			return map[string]any{}
		}
		var parsed map[string]any
		if err := json.Unmarshal(detail, &parsed); err == nil {
			return parsed
		}
	case string:
		if detail == "" {
			return map[string]any{}
		}
		var parsed map[string]any
		if err := json.Unmarshal([]byte(detail), &parsed); err == nil {
			return parsed
		}
	}
	if value == nil {
		return map[string]any{}
	}
	raw, err := json.Marshal(value)
	if err != nil || len(raw) == 0 || string(raw) == "null" {
		return map[string]any{}
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err == nil {
		return parsed
	}
	return map[string]any{}
}
