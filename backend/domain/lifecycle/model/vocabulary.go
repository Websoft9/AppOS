package model

import "strings"

type AppLifecycleState string

type HealthSummary string

type PublicationSummary string

type DesiredAppState string

type OperationType string

type OperationPhase string

type PipelinePhase string

type CompensationPolicy string

type DomainObject string

type ProjectionTarget string

type OperationTrigger string

type OperationChannel string

type OperationExecutionMode string

type RuleProfileKey string

const (
	ProvisionPipeline   = "ProvisionPipeline"
	ChangePipeline      = "ChangePipeline"
	ExposurePipeline    = "ExposurePipeline"
	RecoveryPipeline    = "RecoveryPipeline"
	MaintenancePipeline = "MaintenancePipeline"
	RetirePipeline      = "RetirePipeline"
)

const (
	AppStateRegistered        AppLifecycleState = "registered"
	AppStateInstalling        AppLifecycleState = "installing"
	AppStateRunningHealthy    AppLifecycleState = "running_healthy"
	AppStateRunningDegraded   AppLifecycleState = "running_degraded"
	AppStateMaintenance       AppLifecycleState = "maintenance"
	AppStateUpdating          AppLifecycleState = "updating"
	AppStateRecovering        AppLifecycleState = "recovering"
	AppStateStopped           AppLifecycleState = "stopped"
	AppStateAttentionRequired AppLifecycleState = "attention_required"
	AppStateRetired           AppLifecycleState = "retired"
)

const (
	HealthHealthy  HealthSummary = "healthy"
	HealthDegraded HealthSummary = "degraded"
	HealthUnknown  HealthSummary = "unknown"
	HealthStopped  HealthSummary = "stopped"
)

const (
	PublicationUnpublished PublicationSummary = "unpublished"
	PublicationPublished   PublicationSummary = "published"
	PublicationDegraded    PublicationSummary = "degraded"
	PublicationUnknown     PublicationSummary = "unknown"
)

const (
	DesiredStateRunning DesiredAppState = "running"
	DesiredStateStopped DesiredAppState = "stopped"
	DesiredStateRetired DesiredAppState = "retired"
)

const (
	OperationTypeInstall     OperationType = "install"
	OperationTypeStart       OperationType = "start"
	OperationTypeRestart     OperationType = "restart"
	OperationTypeStop        OperationType = "stop"
	OperationTypeUpgrade     OperationType = "upgrade"
	OperationTypeRedeploy    OperationType = "redeploy"
	OperationTypeReconfigure OperationType = "reconfigure"
	OperationTypePublish     OperationType = "publish"
	OperationTypeUnpublish   OperationType = "unpublish"
	OperationTypeBackup      OperationType = "backup"
	OperationTypeRecover     OperationType = "recover"
	OperationTypeRollback    OperationType = "rollback"
	OperationTypeMaintain    OperationType = "maintain"
	OperationTypeUninstall   OperationType = "uninstall"
	OperationTypeRestore     OperationType = "restore"
)

const (
	OperationPhaseQueued       OperationPhase = "queued"
	OperationPhaseValidating   OperationPhase = "validating"
	OperationPhasePreparing    OperationPhase = "preparing"
	OperationPhaseExecuting    OperationPhase = "executing"
	OperationPhaseVerifying    OperationPhase = "verifying"
	OperationPhaseCompensating OperationPhase = "compensating"
)

const (
	PipelinePhaseValidating   PipelinePhase = "validating"
	PipelinePhasePreparing    PipelinePhase = "preparing"
	PipelinePhaseExecuting    PipelinePhase = "executing"
	PipelinePhaseVerifying    PipelinePhase = "verifying"
	PipelinePhaseCompensating PipelinePhase = "compensating"
)

const (
	CompensationPolicyBestEffort CompensationPolicy = "best_effort"
	CompensationPolicyStrict     CompensationPolicy = "strict"
	CompensationPolicyManualGate CompensationPolicy = "manual_gate"
)

const (
	DomainObjectAppInstance     DomainObject = "AppInstance"
	DomainObjectOperationJob    DomainObject = "OperationJob"
	DomainObjectReleaseSnapshot DomainObject = "ReleaseSnapshot"
	DomainObjectExposure        DomainObject = "Exposure"
	DomainObjectPipelineRun     DomainObject = "PipelineRun"
	DomainObjectPipelineNodeRun DomainObject = "PipelineNodeRun"
)

const (
	ProjectionTargetAppInstance     ProjectionTarget = "AppInstance"
	ProjectionTargetOperationJob    ProjectionTarget = "OperationJob"
	ProjectionTargetReleaseSnapshot ProjectionTarget = "ReleaseSnapshot"
	ProjectionTargetExposure        ProjectionTarget = "Exposure"
)

const (
	TriggerManual    OperationTrigger = "manual"
	TriggerAutomatic OperationTrigger = "automatic"
)

const (
	ChannelStore  OperationChannel = "store"
	ChannelGit    OperationChannel = "git"
	ChannelCustom OperationChannel = "custom"
)

const (
	ExecutionModeCompose OperationExecutionMode = "compose"
	ExecutionModeBuild   OperationExecutionMode = "build"
)

const (
	RuleProfileComposeStandard     RuleProfileKey = "compose_standard"
	RuleProfileSourceBuild         RuleProfileKey = "source_build"
	RuleProfileRuntimeControl      RuleProfileKey = "runtime_control"
	RuleProfileChangeStandard      RuleProfileKey = "change_standard"
	RuleProfileExposureSensitive   RuleProfileKey = "exposure_sensitive"
	RuleProfileRecoveryStrict      RuleProfileKey = "recovery_strict"
	RuleProfileMaintenanceStandard RuleProfileKey = "maintenance_standard"
	RuleProfileRetireStandard      RuleProfileKey = "retire_standard"
)

var PipelineFamilies = []string{
	ProvisionPipeline,
	ChangePipeline,
	ExposurePipeline,
	RecoveryPipeline,
	MaintenancePipeline,
	RetirePipeline,
}

var AppLifecycleStates = []string{
	string(AppStateRegistered),
	string(AppStateInstalling),
	string(AppStateRunningHealthy),
	string(AppStateRunningDegraded),
	string(AppStateMaintenance),
	string(AppStateUpdating),
	string(AppStateRecovering),
	string(AppStateStopped),
	string(AppStateAttentionRequired),
	string(AppStateRetired),
}

var HealthSummaries = []string{
	string(HealthHealthy),
	string(HealthDegraded),
	string(HealthUnknown),
	string(HealthStopped),
}

var PublicationSummaries = []string{
	string(PublicationUnpublished),
	string(PublicationPublished),
	string(PublicationDegraded),
	string(PublicationUnknown),
}

var DesiredAppStates = []string{
	string(DesiredStateRunning),
	string(DesiredStateStopped),
	string(DesiredStateRetired),
}

var OperationTriggers = []string{
	string(TriggerManual),
	string(TriggerAutomatic),
}

var OperationChannels = []string{
	string(ChannelStore),
	string(ChannelGit),
	string(ChannelCustom),
}

var OperationExecutionModes = []string{
	string(ExecutionModeCompose),
	string(ExecutionModeBuild),
}

var RuleProfileKeys = []string{
	string(RuleProfileComposeStandard),
	string(RuleProfileSourceBuild),
	string(RuleProfileRuntimeControl),
	string(RuleProfileChangeStandard),
	string(RuleProfileExposureSensitive),
	string(RuleProfileRecoveryStrict),
	string(RuleProfileMaintenanceStandard),
	string(RuleProfileRetireStandard),
}

func NormalizeOperationTrigger(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case string(TriggerManual):
		return string(TriggerManual)
	case string(TriggerAutomatic):
		return string(TriggerAutomatic)
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func NormalizeOperationChannel(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case string(ChannelStore):
		return string(ChannelStore)
	case string(ChannelGit):
		return string(ChannelGit)
	case string(ChannelCustom):
		return string(ChannelCustom)
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func NormalizeOperationExecutionMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case string(ExecutionModeCompose):
		return string(ExecutionModeCompose)
	case string(ExecutionModeBuild):
		return string(ExecutionModeBuild)
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

var OperationTypes = []string{
	string(OperationTypeInstall),
	string(OperationTypeStart),
	string(OperationTypeRestart),
	string(OperationTypeStop),
	string(OperationTypeUpgrade),
	string(OperationTypeRedeploy),
	string(OperationTypeReconfigure),
	string(OperationTypePublish),
	string(OperationTypeUnpublish),
	string(OperationTypeBackup),
	string(OperationTypeRecover),
	string(OperationTypeRollback),
	string(OperationTypeMaintain),
	string(OperationTypeUninstall),
	string(OperationTypeRestore),
}

var OperationPhases = []string{
	string(OperationPhaseQueued),
	string(OperationPhaseValidating),
	string(OperationPhasePreparing),
	string(OperationPhaseExecuting),
	string(OperationPhaseVerifying),
	string(OperationPhaseCompensating),
}

var PipelinePhases = []string{
	string(PipelinePhaseValidating),
	string(PipelinePhasePreparing),
	string(PipelinePhaseExecuting),
	string(PipelinePhaseVerifying),
	string(PipelinePhaseCompensating),
}

var CompensationPolicies = []string{
	string(CompensationPolicyBestEffort),
	string(CompensationPolicyStrict),
	string(CompensationPolicyManualGate),
}

var DomainObjects = []string{
	string(DomainObjectAppInstance),
	string(DomainObjectOperationJob),
	string(DomainObjectReleaseSnapshot),
	string(DomainObjectExposure),
	string(DomainObjectPipelineRun),
	string(DomainObjectPipelineNodeRun),
}

var ProjectionTargets = []string{
	string(ProjectionTargetAppInstance),
	string(ProjectionTargetOperationJob),
	string(ProjectionTargetReleaseSnapshot),
	string(ProjectionTargetExposure),
}
