package agent

import (
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitorstatus "github.com/websoft9/appos/backend/domain/monitor/status"
)

type RuntimeStatusIngest struct {
	ServerID   string
	ServerName string
	ReportedAt time.Time
	Items      []RuntimeStatusItem
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
		serverSummary["runtime_state"] = strings.TrimSpace(item.RuntimeState)
		serverSummary["containers_running"] = item.Containers.Running
		serverSummary["containers_restarting"] = item.Containers.Restarting
		serverSummary["containers_exited"] = item.Containers.Exited
		serverSummary["app_count"] = len(item.Apps)

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
				if err := applyAppRuntimeStatus(app, serverID, appID, appRuntimeState, observedAt); err != nil {
					return accepted, err
				}
			}
			serverSummary["apps"] = apps
		} else {
			delete(serverSummary, "apps")
		}

		if err := monitorstatus.ApplySignalEvent(app, buildServerRuntimeEvent(input.ServerName, serverID, strings.TrimSpace(item.RuntimeState), observedAt, serverSummary)); err != nil {
			return accepted, err
		}
		accepted++
	}
	return accepted, nil
}

func applyAppRuntimeStatus(app core.App, serverID, appID, runtimeState string, observedAt time.Time) error {
	appDisplayName := appID
	if appRecord, err := app.FindRecordById("app_instances", appID); err == nil {
		if name := strings.TrimSpace(appRecord.GetString("name")); name != "" {
			appDisplayName = name
		}
	}
	appEntry := monitor.ResolveAppBaselineTarget()
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
	appSummary := monitorstatus.LoadExistingSummary(app, monitor.TargetTypeApp, appID)
	appSummary["runtime_state"] = runtimeState
	appSummary["server_id"] = serverID
	monitorstatus.ApplyReasonCode(appSummary, appEntry.AppHealthReasonCodeFor(outcome, ""))
	err := monitorstatus.ApplySignalEvent(app, monitor.CanonicalSignalEvent{
		TargetType:              monitor.TargetTypeApp,
		TargetID:                appID,
		DisplayName:             appDisplayName,
		Status:                  appStatus,
		Reason:                  appReason,
		SignalSource:            monitor.SignalSourceAgent,
		ObservedAt:              observedAt,
		LastSuccessAt:           appLastSuccessAt,
		LastFailureAt:           appLastFailureAt,
		LastCheckedAt:           &observedAt,
		LastReportedAt:          &observedAt,
		ConsecutiveFailures:     &appFailures,
		Summary:                 appSummary,
		StatusPriorityMap:       appEntry.StatusPriority,
		PreserveStrongerFailure: true,
	})
	return err
}

func buildServerRuntimeEvent(serverName, serverID, runtimeState string, observedAt time.Time, summary map[string]any) monitor.CanonicalSignalEvent {
	status := monitor.StatusUnknown
	reason := "runtime summary reported"
	switch strings.ToLower(strings.TrimSpace(runtimeState)) {
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
	serverEntry, ok, err := monitor.ResolveTargetRegistryEntry(monitor.TargetTypeServer, "", "")
	if err != nil || !ok {
		serverEntry = monitor.TargetRegistryEntry{}
	}
	return monitor.CanonicalSignalEvent{
		TargetType:              monitor.TargetTypeServer,
		TargetID:                serverID,
		DisplayName:             serverName,
		Status:                  status,
		Reason:                  reason,
		SignalSource:            monitor.SignalSourceAgent,
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
