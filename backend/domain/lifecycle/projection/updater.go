package projection

import (
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
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
	projection.LifecycleState = DecideAppLifecycleState(AppStateDecisionInput{
		Current:        projection,
		ExistingApp:    options.ExistingApp,
		ActivityAction: model.OperationType(normalizeOperationType(operationRecord)),
		ActivityStatus: ActivityStatusQueued,
	})

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
	projection.StateReason = ""
	projection.LastOperationID = operationRecord.Id
	action := model.OperationType(normalizeOperationType(operationRecord))
	evidence := AppObservedEvidence{}
	activity := AppProjectionActivity{Action: action, Status: ActivityStatusSucceeded}

	switch action {
	case model.OperationTypeStop:
		projection.HealthSummary = model.HealthStopped
		evidence.RuntimeStatus = RuntimeStatusStopped
	case model.OperationTypeUninstall:
		projection.HealthSummary = model.HealthStopped
		evidence.RuntimeStatus = RuntimeStatusStopped
		projection.CurrentReleaseID = ""
		projection.PrimaryExposureID = ""
		projection.RetiredAt = &now
	case model.OperationTypeMaintain:
	case model.OperationTypePublish:
		projection.PublicationSummary = model.PublicationPublished
	case model.OperationTypeUnpublish:
		projection.PublicationSummary = model.PublicationUnpublished
	default:
		evidence.RuntimeStatus = RuntimeStatusRunning
		if projection.HealthSummary == "" || projection.HealthSummary == model.HealthUnknown {
			evidence.HealthSummary = model.HealthHealthy
		}
		if action == model.OperationTypeInstall && projection.InstalledAt == nil {
			projection.InstalledAt = &now
		}
	}

	effective := ResolveEffectiveAppProjection(projection, evidence, activity, "", "")
	projection = effective.Projection
	projection.LastOperationID = operationRecord.Id
	if projection.LifecycleState == model.AppStateRunningHealthy {
		projection.LastHealthyAt = &now
	}
	if strings.TrimSpace(projection.StateReason) == "" {
		projection.StateReason = "operation completed"
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
	projection.LifecycleState = DecideAppLifecycleState(AppStateDecisionInput{
		Current:        projection,
		ActivityAction: model.OperationType(normalizeOperationType(operationRecord)),
		ActivityStatus: ActivityStatusCancelled,
	})

	if projection.CurrentReleaseID == "" && normalizeOperationType(operationRecord) == string(model.OperationTypeInstall) && projection.HealthSummary == "" {
		projection.HealthSummary = model.HealthUnknown
	}

	ApplyAppInstanceProjection(appRecord, projection)
}

func ApplyOperationFailed(appRecord, operationRecord *core.Record) {
	if appRecord == nil || operationRecord == nil {
		return
	}

	projection := ReadAppInstanceProjection(appRecord)
	projection.LastOperationID = operationRecord.Id
	projection.LifecycleState = DecideAppLifecycleState(AppStateDecisionInput{
		Current:        projection,
		ActivityAction: model.OperationType(normalizeOperationType(operationRecord)),
		ActivityStatus: ActivityStatusFailed,
	})
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
