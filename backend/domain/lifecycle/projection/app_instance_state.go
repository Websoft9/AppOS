package projection

import (
	"fmt"
	"strings"

	"github.com/websoft9/appos/backend/domain/lifecycle/model"
)

type RuntimeStatus string

type InstanceState string

const (
	RuntimeStatusUnknown    RuntimeStatus = "unknown"
	RuntimeStatusRunning    RuntimeStatus = "running"
	RuntimeStatusPartial    RuntimeStatus = "partial"
	RuntimeStatusStarting   RuntimeStatus = "starting"
	RuntimeStatusRestarting RuntimeStatus = "restarting"
	RuntimeStatusStopped    RuntimeStatus = "stopped"
	RuntimeStatusError      RuntimeStatus = "error"
)

const (
	InstanceStateInstalling        InstanceState = "installing"
	InstanceStateRunning           InstanceState = "running"
	InstanceStateDegraded          InstanceState = "degraded"
	InstanceStateStopped           InstanceState = "stopped"
	InstanceStateUpdating          InstanceState = "updating"
	InstanceStateUninstalling      InstanceState = "uninstalling"
	InstanceStateAttentionRequired InstanceState = "attention_required"
	InstanceStateRetired           InstanceState = "retired"
	InstanceStateUnknown           InstanceState = "unknown"
)

type ActivityStatus string

const (
	ActivityStatusIdle      ActivityStatus = "idle"
	ActivityStatusQueued    ActivityStatus = "queued"
	ActivityStatusSucceeded ActivityStatus = "succeeded"
	ActivityStatusFailed    ActivityStatus = "failed"
	ActivityStatusCancelled ActivityStatus = "cancelled"
)

type AppStateDecisionInput struct {
	Current            model.AppInstanceProjection
	ExistingApp        bool
	ActivityAction     model.OperationType
	ActivityStatus     ActivityStatus
	DesiredState       model.DesiredAppState
	RuntimeStatus      RuntimeStatus
	HealthSummary      model.HealthSummary
	PublicationSummary model.PublicationSummary
}

type AppObservedEvidence struct {
	RuntimeStatus      RuntimeStatus
	HealthSummary      model.HealthSummary
	PublicationSummary model.PublicationSummary
	MonitorReason      string
}

type AppProjectionActivity struct {
	Action         model.OperationType
	Status         ActivityStatus
	CurrentPhase   string
	PipelineStatus string
}

type AppProjectionSources struct {
	PrimaryExposurePublicationState string
	PrimaryExposureHealthState      string
	MonitorStatus                   string
	MonitorReason                   string
	MonitorSummary                  map[string]any
	CurrentPipeline                 map[string]any
	LiveRuntimeStatus               string
	RuntimeReason                   string
}

type EffectiveAppProjection struct {
	Projection    model.AppInstanceProjection
	InstanceState InstanceState
	RuntimeStatus RuntimeStatus
}

func ProjectionActivityFromPipeline(current model.AppInstanceProjection, currentPipeline map[string]any) AppProjectionActivity {
	activity := AppProjectionActivity{Status: ActivityStatusIdle}
	if currentPipeline == nil {
		return activity
	}
	if selector, ok := currentPipeline["selector"].(map[string]any); ok {
		activity.Action = model.OperationType(strings.TrimSpace(fmt.Sprint(selector["operation_type"])))
	}
	status := stringValue(currentPipeline["status"])
	phase := stringValue(currentPipeline["current_phase"])
	activity.PipelineStatus = status
	activity.CurrentPhase = phase
	if activity.Action != "" && (status == "active" || (status == "" && phase != "")) {
		activity.Status = ActivityStatusQueued
	}
	if activity.Action == "" && current.LifecycleState == model.AppStateInstalling {
		activity.Action = model.OperationTypeInstall
		activity.Status = ActivityStatusQueued
	}
	return activity
}

func ResolveObservedEvidence(primaryExposurePublicationState string, primaryExposureHealthState string, monitorStatus string, monitorReason string, summary map[string]any) AppObservedEvidence {
	evidence := AppObservedEvidence{}
	evidence.PublicationSummary = NormalizePublicationSummary(primaryExposurePublicationState, primaryExposureHealthState)
	evidence.MonitorReason = strings.TrimSpace(monitorReason)
	if len(summary) == 0 {
		applyMonitorStatusEvidence(&evidence, monitorStatus)
		return evidence
	}
	if runtimeRaw := strings.TrimSpace(fmt.Sprint(summary["runtime_status"])); runtimeRaw != "" {
		evidence.RuntimeStatus = NormalizeRuntimeStatus(runtimeRaw)
	}
	if healthRaw := strings.TrimSpace(fmt.Sprint(summary["health_summary"])); healthRaw != "" {
		evidence.HealthSummary = NormalizeHealthSummary(healthRaw)
	}
	if publicationRaw := strings.TrimSpace(fmt.Sprint(summary["publication_summary"])); publicationRaw != "" {
		if normalized := NormalizePublicationSummary(publicationRaw, ""); normalized != "" {
			if evidence.PublicationSummary != model.PublicationDegraded || normalized == model.PublicationDegraded {
				evidence.PublicationSummary = normalized
			}
		}
	}
	applyMonitorStatusEvidence(&evidence, monitorStatus)
	return evidence
}

func ResolveEffectiveAppProjectionFromSources(current model.AppInstanceProjection, sources AppProjectionSources) EffectiveAppProjection {
	evidence := ResolveObservedEvidence(
		sources.PrimaryExposurePublicationState,
		sources.PrimaryExposureHealthState,
		sources.MonitorStatus,
		sources.MonitorReason,
		sources.MonitorSummary,
	)
	activity := ProjectionActivityFromPipeline(current, sources.CurrentPipeline)
	return ResolveEffectiveAppProjection(current, evidence, activity, sources.LiveRuntimeStatus, sources.RuntimeReason)
}

func NormalizeRuntimeStatus(raw string) RuntimeStatus {
	value := strings.ToLower(strings.TrimSpace(raw))
	switch {
	case value == "":
		return RuntimeStatusUnknown
	case strings.Contains(value, "restarting"):
		return RuntimeStatusRestarting
	case strings.Contains(value, "starting"), strings.Contains(value, "created"):
		return RuntimeStatusStarting
	case strings.Contains(value, "partial"), strings.Contains(value, "degraded"):
		return RuntimeStatusPartial
	case strings.Contains(value, "running"), strings.HasPrefix(value, "up"):
		return RuntimeStatusRunning
	case strings.Contains(value, "exited"), strings.Contains(value, "stopped"), strings.Contains(value, "stopping"):
		return RuntimeStatusStopped
	case strings.Contains(value, "dead"), strings.Contains(value, "error"), strings.Contains(value, "failed"):
		return RuntimeStatusError
	default:
		return RuntimeStatusUnknown
	}
}

func RuntimeStatusFromProjection(current model.AppInstanceProjection) RuntimeStatus {
	switch current.LifecycleState {
	case model.AppStateRunningHealthy, model.AppStateRunningDegraded:
		return RuntimeStatusRunning
	case model.AppStateStopped, model.AppStateRetired:
		return RuntimeStatusStopped
	case model.AppStateAttentionRequired:
		return RuntimeStatusError
	default:
		if current.HealthSummary == model.HealthStopped || current.DesiredState == model.DesiredStateStopped {
			return RuntimeStatusStopped
		}
		if current.HealthSummary == model.HealthHealthy {
			return RuntimeStatusRunning
		}
		if current.HealthSummary == model.HealthDegraded || current.PublicationSummary == model.PublicationDegraded {
			return RuntimeStatusPartial
		}
		return RuntimeStatusUnknown
	}
}

func NormalizeHealthSummary(raw string) model.HealthSummary {
	value := strings.ToLower(strings.TrimSpace(raw))
	switch value {
	case string(model.HealthHealthy):
		return model.HealthHealthy
	case string(model.HealthDegraded), "error", "failed", "unhealthy":
		return model.HealthDegraded
	case string(model.HealthStopped), "offline", "exited":
		return model.HealthStopped
	case string(model.HealthUnknown), "":
		return model.HealthUnknown
	default:
		return ""
	}
}

func NormalizePublicationSummary(publicationState string, healthState string) model.PublicationSummary {
	publication := strings.ToLower(strings.TrimSpace(publicationState))
	health := strings.ToLower(strings.TrimSpace(healthState))
	switch publication {
	case string(model.PublicationPublished), "publishing":
		if health == "degraded" {
			return model.PublicationDegraded
		}
		return model.PublicationPublished
	case "published_degraded", "publication_failed", "publication_attention_required":
		return model.PublicationDegraded
	case string(model.PublicationUnpublished), "unpublishing":
		return model.PublicationUnpublished
	case string(model.PublicationDegraded):
		return model.PublicationDegraded
	case string(model.PublicationUnknown), "":
		if health == "degraded" {
			return model.PublicationDegraded
		}
		return ""
	default:
		if health == "degraded" {
			return model.PublicationDegraded
		}
		return ""
	}
}

func applyMonitorStatusEvidence(evidence *AppObservedEvidence, monitorStatus string) {
	if evidence == nil {
		return
	}
	switch strings.ToLower(strings.TrimSpace(monitorStatus)) {
	case "healthy":
		if evidence.HealthSummary == "" {
			evidence.HealthSummary = model.HealthHealthy
		}
	case "degraded":
		if evidence.HealthSummary == "" {
			evidence.HealthSummary = model.HealthDegraded
		}
	case "offline":
		if evidence.RuntimeStatus == "" || evidence.RuntimeStatus == RuntimeStatusUnknown {
			evidence.RuntimeStatus = RuntimeStatusStopped
		}
		if evidence.HealthSummary == "" || evidence.HealthSummary == model.HealthUnknown {
			evidence.HealthSummary = model.HealthStopped
		}
	}
}

func MergeObservedEvidence(current model.AppInstanceProjection, evidence AppObservedEvidence) model.AppInstanceProjection {
	merged := current
	if evidence.HealthSummary != "" {
		merged.HealthSummary = evidence.HealthSummary
	}
	if evidence.PublicationSummary != "" {
		merged.PublicationSummary = evidence.PublicationSummary
	}
	if evidence.RuntimeStatus == RuntimeStatusStopped && merged.HealthSummary == model.HealthUnknown {
		merged.HealthSummary = model.HealthStopped
	}
	return merged
}

func ResolveRuntimeStatus(current model.AppInstanceProjection, observed RuntimeStatus, liveRaw string, runtimeReason string) RuntimeStatus {
	if strings.TrimSpace(liveRaw) != "" {
		return NormalizeRuntimeStatus(liveRaw)
	}
	if observed != "" && observed != RuntimeStatusUnknown {
		return observed
	}
	if strings.TrimSpace(runtimeReason) != "" {
		return RuntimeStatusUnknown
	}
	return RuntimeStatusFromProjection(current)
}

func ResolveEffectiveAppProjection(current model.AppInstanceProjection, evidence AppObservedEvidence, activity AppProjectionActivity, liveRaw string, runtimeReason string) EffectiveAppProjection {
	effective := MergeObservedEvidence(current, evidence)
	runtimeStatus := ResolveRuntimeStatus(effective, evidence.RuntimeStatus, liveRaw, runtimeReason)

	effective.LifecycleState = DecideAppLifecycleState(AppStateDecisionInput{
		Current:            effective,
		ExistingApp:        effective.InstalledAt != nil || effective.CurrentReleaseID != "",
		ActivityAction:     activity.Action,
		ActivityStatus:     activity.Status,
		DesiredState:       effective.DesiredState,
		RuntimeStatus:      runtimeStatus,
		HealthSummary:      effective.HealthSummary,
		PublicationSummary: effective.PublicationSummary,
	})
	if effective.LifecycleState == "" {
		effective.LifecycleState = current.LifecycleState
	}
	effective.StateReason = ResolveEffectiveStateReason(current, effective, evidence, activity, runtimeStatus, runtimeReason)

	return EffectiveAppProjection{
		Projection:    effective,
		InstanceState: ResolveInstanceState(effective, activity, runtimeStatus, runtimeReason),
		RuntimeStatus: runtimeStatus,
	}
}

func ResolveInstanceState(effective model.AppInstanceProjection, activity AppProjectionActivity, runtimeStatus RuntimeStatus, runtimeReason string) InstanceState {
	if activity.Status == ActivityStatusQueued {
		switch activity.Action {
		case model.OperationTypeInstall:
			return InstanceStateInstalling
		case model.OperationTypeUninstall:
			return InstanceStateUninstalling
		case model.OperationTypeStart,
			model.OperationTypeStop,
			model.OperationTypeRestart,
			model.OperationTypeUpgrade,
			model.OperationTypeRedeploy,
			model.OperationTypeReconfigure,
			model.OperationTypePublish,
			model.OperationTypeUnpublish,
			model.OperationTypeRecover,
			model.OperationTypeRollback,
			model.OperationTypeRestore,
			model.OperationTypeMaintain:
			return InstanceStateUpdating
		}
	}

	if runtimeStatus == RuntimeStatusUnknown && strings.TrimSpace(runtimeReason) != "" {
		if effective.DesiredState == model.DesiredStateStopped || effective.LifecycleState == model.AppStateStopped {
			return InstanceStateStopped
		}
		return InstanceStateUnknown
	}

	switch effective.LifecycleState {
	case model.AppStateInstalling:
		return InstanceStateInstalling
	case model.AppStateRunningHealthy:
		return InstanceStateRunning
	case model.AppStateRunningDegraded:
		return InstanceStateDegraded
	case model.AppStateMaintenance, model.AppStateUpdating, model.AppStateRecovering:
		return InstanceStateUpdating
	case model.AppStateStopped:
		return InstanceStateStopped
	case model.AppStateAttentionRequired:
		return InstanceStateAttentionRequired
	case model.AppStateRetired:
		return InstanceStateRetired
	default:
		return InstanceStateUnknown
	}
}

func ResolveEffectiveStateReason(current model.AppInstanceProjection, effective model.AppInstanceProjection, evidence AppObservedEvidence, activity AppProjectionActivity, runtimeStatus RuntimeStatus, runtimeReason string) string {
	if activity.Status == ActivityStatusQueued {
		if reason := activityReason(activity.Action); reason != "" {
			return reason
		}
		return "operation queued"
	}
	if runtimeStatus == RuntimeStatusUnknown && strings.TrimSpace(runtimeReason) != "" {
		return strings.TrimSpace(runtimeReason)
	}
	if effective.LifecycleState == model.AppStateStopped && effective.DesiredState == model.DesiredStateStopped {
		return "desired state stopped"
	}
	if effective.LifecycleState == model.AppStateRunningDegraded {
		switch {
		case runtimeStatus == RuntimeStatusRestarting:
			return "runtime restarting"
		case runtimeStatus == RuntimeStatusError:
			return "runtime error"
		case runtimeStatus == RuntimeStatusPartial:
			return "runtime degraded"
		case evidence.PublicationSummary == model.PublicationDegraded || effective.PublicationSummary == model.PublicationDegraded:
			return "publication degraded"
		case strings.TrimSpace(evidence.MonitorReason) != "":
			return strings.TrimSpace(evidence.MonitorReason)
		case evidence.HealthSummary == model.HealthDegraded || effective.HealthSummary == model.HealthDegraded:
			return "health degraded"
		}
	}
	if strings.TrimSpace(evidence.MonitorReason) != "" {
		return strings.TrimSpace(evidence.MonitorReason)
	}
	if strings.TrimSpace(effective.StateReason) != "" {
		return strings.TrimSpace(effective.StateReason)
	}
	return strings.TrimSpace(current.StateReason)
}

func activityReason(action model.OperationType) string {
	switch action {
	case model.OperationTypeInstall:
		return "install in progress"
	case model.OperationTypeUninstall:
		return "uninstall in progress"
	case model.OperationTypeUpgrade:
		return "upgrade in progress"
	case model.OperationTypeRedeploy:
		return "redeploy in progress"
	case model.OperationTypeReconfigure:
		return "reconfigure in progress"
	case model.OperationTypeStart:
		return "start in progress"
	case model.OperationTypeStop:
		return "stop in progress"
	case model.OperationTypeRestart:
		return "restart in progress"
	case model.OperationTypePublish:
		return "publish in progress"
	case model.OperationTypeUnpublish:
		return "unpublish in progress"
	case model.OperationTypeRecover:
		return "recover in progress"
	case model.OperationTypeRollback:
		return "rollback in progress"
	case model.OperationTypeRestore:
		return "restore in progress"
	case model.OperationTypeMaintain:
		return "maintenance in progress"
	default:
		return ""
	}
}

func stringValue(raw any) string {
	if raw == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(raw))
}

func DecideAppLifecycleState(input AppStateDecisionInput) model.AppLifecycleState {
	switch input.ActivityStatus {
	case ActivityStatusQueued:
		return decideQueuedLifecycleState(input)
	case ActivityStatusFailed:
		return model.AppStateAttentionRequired
	case ActivityStatusCancelled:
		if input.ActivityAction == model.OperationTypeInstall && input.Current.CurrentReleaseID == "" {
			return model.AppStateRegistered
		}
		if input.Current.LifecycleState != "" {
			return input.Current.LifecycleState
		}
		return decideObservedLifecycleState(input)
	case ActivityStatusSucceeded:
		return decideSucceededLifecycleState(input)
	default:
		return decideObservedLifecycleState(input)
	}
}

func decideQueuedLifecycleState(input AppStateDecisionInput) model.AppLifecycleState {
	switch input.ActivityAction {
	case model.OperationTypeRecover, model.OperationTypeRollback, model.OperationTypeRestore:
		return model.AppStateRecovering
	case model.OperationTypeMaintain:
		return model.AppStateMaintenance
	default:
		if input.ExistingApp {
			return model.AppStateUpdating
		}
		return model.AppStateInstalling
	}
}

func decideSucceededLifecycleState(input AppStateDecisionInput) model.AppLifecycleState {
	switch input.ActivityAction {
	case model.OperationTypeStop:
		return model.AppStateStopped
	case model.OperationTypeUninstall:
		return model.AppStateRetired
	case model.OperationTypeMaintain:
		return model.AppStateMaintenance
	case model.OperationTypePublish, model.OperationTypeUnpublish:
		if input.Current.LifecycleState != "" {
			return input.Current.LifecycleState
		}
	}

	observed := decideObservedLifecycleState(input)
	if observed != "" {
		return observed
	}
	return model.AppStateRunningHealthy
}

func decideObservedLifecycleState(input AppStateDecisionInput) model.AppLifecycleState {
	if input.HealthSummary == model.HealthStopped || input.DesiredState == model.DesiredStateStopped || input.RuntimeStatus == RuntimeStatusStopped {
		return model.AppStateStopped
	}

	if input.RuntimeStatus == RuntimeStatusError || input.RuntimeStatus == RuntimeStatusPartial || input.RuntimeStatus == RuntimeStatusRestarting || input.HealthSummary == model.HealthDegraded || input.PublicationSummary == model.PublicationDegraded {
		return model.AppStateRunningDegraded
	}

	if input.RuntimeStatus == RuntimeStatusStarting {
		if input.ExistingApp {
			return model.AppStateUpdating
		}
		return model.AppStateInstalling
	}

	if input.RuntimeStatus == RuntimeStatusRunning || input.HealthSummary == model.HealthHealthy {
		if input.HealthSummary == model.HealthHealthy && input.PublicationSummary != model.PublicationDegraded {
			return model.AppStateRunningHealthy
		}
		return model.AppStateRunningDegraded
	}

	if input.Current.LifecycleState != "" {
		return input.Current.LifecycleState
	}
	return ""
}
