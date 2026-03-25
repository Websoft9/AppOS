package projection

import (
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/internal/lifecycle/model"
)

type QueueOptions struct {
	ExistingApp bool
}

func ReadAppInstanceProjection(appRecord *core.Record) model.AppInstanceProjection {
	if appRecord == nil {
		return model.AppInstanceProjection{}
	}

	projection := model.AppInstanceProjection{
		LifecycleState:     model.AppLifecycleState(strings.TrimSpace(appRecord.GetString("lifecycle_state"))),
		HealthSummary:      model.HealthSummary(strings.TrimSpace(appRecord.GetString("health_summary"))),
		PublicationSummary: model.PublicationSummary(strings.TrimSpace(appRecord.GetString("publication_summary"))),
		DesiredState:       model.DesiredAppState(strings.TrimSpace(appRecord.GetString("desired_state"))),
		StateReason:        strings.TrimSpace(appRecord.GetString("state_reason")),
		LastOperationID:    strings.TrimSpace(appRecord.GetString("last_operation")),
		CurrentReleaseID:   strings.TrimSpace(appRecord.GetString("current_release")),
		PrimaryExposureID:  strings.TrimSpace(appRecord.GetString("primary_exposure")),
	}

	if value := appRecord.GetDateTime("installed_at"); !value.IsZero() {
		timeValue := value.Time()
		projection.InstalledAt = &timeValue
	}
	if value := appRecord.GetDateTime("last_healthy_at"); !value.IsZero() {
		timeValue := value.Time()
		projection.LastHealthyAt = &timeValue
	}
	if value := appRecord.GetDateTime("retired_at"); !value.IsZero() {
		timeValue := value.Time()
		projection.RetiredAt = &timeValue
	}

	return projection
}

func ApplyAppInstanceProjection(appRecord *core.Record, projection model.AppInstanceProjection) {
	if appRecord == nil {
		return
	}

	if projection.LifecycleState != "" {
		appRecord.Set("lifecycle_state", string(projection.LifecycleState))
	}
	if projection.HealthSummary != "" {
		appRecord.Set("health_summary", string(projection.HealthSummary))
	}
	if projection.PublicationSummary != "" {
		appRecord.Set("publication_summary", string(projection.PublicationSummary))
	}
	if projection.DesiredState != "" {
		appRecord.Set("desired_state", string(projection.DesiredState))
	}
	appRecord.Set("state_reason", projection.StateReason)
	appRecord.Set("last_operation", projection.LastOperationID)
	appRecord.Set("current_release", projection.CurrentReleaseID)
	appRecord.Set("primary_exposure", projection.PrimaryExposureID)

	if projection.InstalledAt != nil {
		appRecord.Set("installed_at", *projection.InstalledAt)
	}
	if projection.LastHealthyAt != nil {
		appRecord.Set("last_healthy_at", *projection.LastHealthyAt)
	}
	if projection.RetiredAt != nil {
		appRecord.Set("retired_at", *projection.RetiredAt)
	}
}

func ApplyOperationQueued(appRecord, operationRecord *core.Record, options QueueOptions) {
	if appRecord == nil || operationRecord == nil {
		return
	}

	projection := ReadAppInstanceProjection(appRecord)
	projection.LastOperationID = operationRecord.Id
	projection.StateReason = "operation queued"

	switch normalizeOperationType(operationRecord) {
	case string(model.OperationTypeRecover), string(model.OperationTypeRollback), string(model.OperationTypeRestore):
		projection.LifecycleState = model.AppStateRecovering
	case string(model.OperationTypeMaintain):
		projection.LifecycleState = model.AppStateMaintenance
	default:
		if options.ExistingApp {
			projection.LifecycleState = model.AppStateUpdating
		} else {
			projection.LifecycleState = model.AppStateInstalling
		}
	}

	ApplyAppInstanceProjection(appRecord, projection)
}

func ApplyOperationSucceeded(appRecord, operationRecord *core.Record, now time.Time) {
	if appRecord == nil || operationRecord == nil {
		return
	}
	if now.IsZero() {
		now = time.Now()
	}

	projection := ReadAppInstanceProjection(appRecord)
	projection.LastOperationID = operationRecord.Id
	projection.StateReason = "operation completed"

	switch normalizeOperationType(operationRecord) {
	case string(model.OperationTypeStop):
		projection.LifecycleState = model.AppStateStopped
		projection.HealthSummary = model.HealthStopped
	case string(model.OperationTypeUninstall):
		projection.LifecycleState = model.AppStateRetired
		projection.HealthSummary = model.HealthStopped
		projection.RetiredAt = &now
	case string(model.OperationTypeMaintain):
		projection.LifecycleState = model.AppStateMaintenance
	case string(model.OperationTypePublish):
		projection.PublicationSummary = model.PublicationPublished
	case string(model.OperationTypeUnpublish):
		projection.PublicationSummary = model.PublicationUnpublished
	default:
		projection.LifecycleState = model.AppStateRunningHealthy
		projection.HealthSummary = model.HealthHealthy
		projection.LastHealthyAt = &now
		if normalizeOperationType(operationRecord) == string(model.OperationTypeInstall) && projection.InstalledAt == nil {
			projection.InstalledAt = &now
		}
	}

	ApplyAppInstanceProjection(appRecord, projection)
}

func ApplyOperationCancelled(appRecord, operationRecord *core.Record) {
	if appRecord == nil || operationRecord == nil {
		return
	}

	projection := ReadAppInstanceProjection(appRecord)
	projection.LastOperationID = operationRecord.Id
	projection.StateReason = "operation cancelled"

	if projection.CurrentReleaseID == "" && normalizeOperationType(operationRecord) == string(model.OperationTypeInstall) {
		projection.LifecycleState = model.AppStateRegistered
		if projection.HealthSummary == "" {
			projection.HealthSummary = model.HealthUnknown
		}
	}

	ApplyAppInstanceProjection(appRecord, projection)
}

func ApplyOperationFailed(appRecord, operationRecord *core.Record) {
	if appRecord == nil || operationRecord == nil {
		return
	}

	projection := ReadAppInstanceProjection(appRecord)
	projection.LastOperationID = operationRecord.Id
	projection.LifecycleState = model.AppStateAttentionRequired
	projection.StateReason = failureStateReason(operationRecord)
	if projection.HealthSummary == "" {
		projection.HealthSummary = model.HealthUnknown
	}

	ApplyAppInstanceProjection(appRecord, projection)
}

func normalizeOperationType(operationRecord *core.Record) string {
	if operationRecord == nil {
		return ""
	}

	return strings.TrimSpace(operationRecord.GetString("operation_type"))
}

func failureStateReason(operationRecord *core.Record) string {
	if operationRecord == nil {
		return "operation failed"
	}

	if message := strings.TrimSpace(operationRecord.GetString("error_message")); message != "" {
		return message
	}
	if reason := strings.TrimSpace(operationRecord.GetString("failure_reason")); reason != "" {
		return strings.ReplaceAll(reason, "_", " ")
	}

	return "operation failed"
}
