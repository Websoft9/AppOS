package snapshots

import (
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitorstatus "github.com/websoft9/appos/backend/domain/monitor/status"
)

type RuntimeStatusIngest struct {
	ServerID     string
	ServerName   string
	ReportedAt   time.Time
	SignalSource string
	Items        []RuntimeStatusItem
}

type RuntimeStatusItem struct {
	TargetType   string
	TargetID     string
	RuntimeState string
	ObservedAt   time.Time
	Containers   RuntimeContainerSummary
	Apps         []RuntimeAppStatus
}

type RuntimeContainerSummary struct {
	Running    int
	Restarting int
	Exited     int
}

type RuntimeAppStatus struct {
	AppID        string
	RuntimeState string
}

func IngestRuntimeStatus(app core.App, input RuntimeStatusIngest) (int, error) {
	serverID := strings.TrimSpace(input.ServerID)
	signalSource := strings.TrimSpace(input.SignalSource)
	if signalSource == "" {
		signalSource = monitor.SignalSourceAppOS
	}
	appEntry := monitor.ResolveAppBaselineTarget()
	serverEntry, ok, err := monitor.ResolveTargetRegistryEntry(monitor.TargetTypeServer, "", "")
	if err != nil || !ok {
		serverEntry = monitor.TargetRegistryEntry{}
	}
	accepted := 0
	for _, item := range input.Items {
		if strings.TrimSpace(item.TargetType) != monitor.TargetTypeServer || strings.TrimSpace(item.TargetID) != serverID {
			return accepted, ErrRuntimeStatusTargetMismatch
		}
		observedAt := item.ObservedAt
		if observedAt.IsZero() {
			observedAt = input.ReportedAt
		}

		serverSummary := monitorstatus.LoadExistingSummary(app, monitor.TargetTypeServer, serverID)
		serverSummary["check_kind"] = monitor.CheckKindRuntime
		serverSummary["signal_source"] = signalSource
		serverSummary["runtime_state"] = strings.TrimSpace(item.RuntimeState)
		serverSummary["containers_running"] = item.Containers.Running
		serverSummary["containers_restarting"] = item.Containers.Restarting
		serverSummary["containers_exited"] = item.Containers.Exited
		serverSummary["app_count"] = len(item.Apps)

		if len(item.Apps) > 0 {
			displayNames, err := batchLoadAppDisplayNames(app, item.Apps)
			if err != nil {
				return accepted, err
			}
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
				if err := applyAppRuntimeStatus(app, appEntry, serverID, appID, appRuntimeState, signalSource, observedAt, displayNames[appID]); err != nil {
					return accepted, err
				}
			}
			serverSummary["apps"] = apps
		} else {
			delete(serverSummary, "apps")
		}

		if err := monitorstatus.ApplySignalEvent(app, buildServerRuntimeEvent(serverEntry, input.ServerName, serverID, strings.TrimSpace(item.RuntimeState), signalSource, observedAt, serverSummary)); err != nil {
			return accepted, err
		}
		accepted++
	}
	return accepted, nil
}

// batchLoadAppDisplayNames loads app display names for all provided RuntimeAppStatus items
// in a single DB query, avoiding N+1 reads when a snapshot contains multiple apps.
func batchLoadAppDisplayNames(app core.App, apps []RuntimeAppStatus) (map[string]string, error) {
	result := make(map[string]string)
	ids := make([]string, 0, len(apps))
	for _, item := range apps {
		if id := strings.TrimSpace(item.AppID); id != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return result, nil
	}
	parts := make([]string, len(ids))
	params := make(map[string]any, len(ids))
	for i, id := range ids {
		key := fmt.Sprintf("aid%d", i)
		parts[i] = "id = {:" + key + "}"
		params[key] = id
	}
	records, err := app.FindRecordsByFilter(
		"app_instances",
		strings.Join(parts, " || "),
		"-created",
		0, 0,
		params,
	)
	if err != nil {
		return nil, err
	}
	for _, rec := range records {
		if name := strings.TrimSpace(rec.GetString("name")); name != "" {
			result[rec.Id] = name
		}
	}
	return result, nil
}

func applyAppRuntimeStatus(app core.App, appEntry monitor.TargetRegistryEntry, serverID, appID, runtimeState, signalSource string, observedAt time.Time, displayName string) error {
	appDisplayName := appID
	if displayName != "" {
		appDisplayName = displayName
	}
	appSummary := monitorstatus.LoadExistingSummary(app, monitor.TargetTypeApp, appID)
	appSummary["runtime_state"] = runtimeState
	appSummary["server_id"] = serverID
	event := buildAppRuntimeEvent(appEntry, appDisplayName, serverID, appID, runtimeState, signalSource, observedAt, appSummary)
	return monitorstatus.ApplySignalEvent(app, event)
}

func buildAppRuntimeEvent(appEntry monitor.TargetRegistryEntry, appDisplayName, serverID, appID, runtimeState, signalSource string, observedAt time.Time, summary map[string]any) monitor.CanonicalSignalEvent {
	outcome := monitor.AppHealthOutcomeFromRuntimeState(runtimeState)
	appStatus := appEntry.AppHealthStatusFor(outcome)
	appReason := appEntry.AppHealthReasonFor(outcome, "")
	appFailures := 0
	appLastSuccessAt := (*time.Time)(nil)
	appLastFailureAt := (*time.Time)(nil)
	if appStatus == monitor.StatusHealthy {
		appLastSuccessAt = &observedAt
	} else if appStatus == monitor.StatusDegraded {
		appFailures = 1
		appLastFailureAt = &observedAt
	}
	monitorstatus.ApplyReasonCode(summary, appEntry.AppHealthReasonCodeFor(outcome, ""))
	return monitor.CanonicalSignalEvent{
		TargetType:              monitor.TargetTypeApp,
		TargetID:                appID,
		DisplayName:             appDisplayName,
		Status:                  appStatus,
		Reason:                  appReason,
		SignalSource:            signalSource,
		ObservedAt:              observedAt,
		LastSuccessAt:           appLastSuccessAt,
		LastFailureAt:           appLastFailureAt,
		LastCheckedAt:           &observedAt,
		LastReportedAt:          &observedAt,
		ConsecutiveFailures:     &appFailures,
		Summary:                 summary,
		StatusPriorityMap:       appEntry.StatusPriority,
		PreserveStrongerFailure: true,
	}
}

func buildServerRuntimeEvent(serverEntry monitor.TargetRegistryEntry, serverName, serverID, runtimeState, signalSource string, observedAt time.Time, summary map[string]any) monitor.CanonicalSignalEvent {
	outcome := monitor.RuntimeSummaryOutcomeFromRuntimeState(runtimeState)
	status := serverEntry.RuntimeStatusFor(outcome)
	reason := serverEntry.RuntimeReasonFor(outcome, "")
	monitorstatus.ApplyReasonCode(summary, serverEntry.RuntimeReasonCodeFor(outcome, ""))
	failures := 0
	lastSuccessAt := (*time.Time)(nil)
	lastFailureAt := (*time.Time)(nil)
	if status == monitor.StatusHealthy {
		lastSuccessAt = &observedAt
	} else if status == monitor.StatusDegraded {
		failures = 1
		lastFailureAt = &observedAt
	}
	return monitor.CanonicalSignalEvent{
		TargetType:              monitor.TargetTypeServer,
		TargetID:                serverID,
		DisplayName:             serverName,
		Status:                  status,
		Reason:                  reason,
		SignalSource:            signalSource,
		ObservedAt:              observedAt,
		LastSuccessAt:           lastSuccessAt,
		LastFailureAt:           lastFailureAt,
		LastCheckedAt:           &observedAt,
		LastReportedAt:          &observedAt,
		ConsecutiveFailures:     &failures,
		Summary:                 summary,
		StatusPriorityMap:       serverEntry.StatusPriority,
		PreserveStrongerFailure: true,
	}
}
