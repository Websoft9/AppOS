package serverbase

type TemplateKind string

const (
	TemplateKindPackage TemplateKind = "package"
	TemplateKindScript  TemplateKind = "script"
)

type ComponentKey string

const (
	ComponentKeyDocker       ComponentKey = "docker"
	ComponentKeyMonitorAgent ComponentKey = "monitor-agent"
	ComponentKeyControlAgent ComponentKey = "control-agent"
	ComponentKeyReverseProxy ComponentKey = "reverse-proxy"
)

type Capability string

const (
	CapabilityContainerRuntime Capability = "container_runtime"
	CapabilityMonitorAgent     Capability = "monitor_agent"
	CapabilityControlPlane     Capability = "control_plane"
	CapabilityReverseProxy     Capability = "reverse_proxy"
)

type InstalledState string

const (
	InstalledStateInstalled    InstalledState = "installed"
	InstalledStateNotInstalled InstalledState = "not_installed"
	InstalledStateUnknown      InstalledState = "unknown"
)

type VerificationState string

const (
	VerificationStateHealthy  VerificationState = "healthy"
	VerificationStateDegraded VerificationState = "degraded"
	VerificationStateUnknown  VerificationState = "unknown"
)

type Action string

const (
	ActionInstall Action = "install"
	ActionUpgrade Action = "upgrade"
	ActionVerify  Action = "verify"
)

type OperationPhase string

const (
	OperationPhaseAccepted          OperationPhase = "accepted"
	OperationPhasePreflight         OperationPhase = "preflight"
	OperationPhaseExecuting         OperationPhase = "executing"
	OperationPhaseVerifying         OperationPhase = "verifying"
	OperationPhaseSucceeded         OperationPhase = "succeeded"
	OperationPhaseFailed            OperationPhase = "failed"
	OperationPhaseAttentionRequired OperationPhase = "attention_required"
)

type TerminalStatus string

const (
	TerminalStatusNone    TerminalStatus = "none"
	TerminalStatusSuccess TerminalStatus = "success"
	TerminalStatusFailed  TerminalStatus = "failed"
)

const (
	AuditActionInstall = "server.serverbase.install"
	AuditActionUpgrade = "server.serverbase.upgrade"
	AuditActionVerify  = "server.serverbase.verify"
)

type LastAction struct {
	Action string `json:"action"`
	Result string `json:"result"`
	At     string `json:"at"`
}

type PreflightResult struct {
	OK          bool     `json:"ok"`
	OSSupported bool     `json:"os_supported"`
	PrivilegeOK bool     `json:"privilege_ok"`
	NetworkOK   bool     `json:"network_ok"`
	Issues      []string `json:"issues,omitempty"`
}

type VerificationResult struct {
	State     VerificationState `json:"state"`
	CheckedAt string            `json:"checked_at"`
	Reason    string            `json:"reason,omitempty"`
	Details   map[string]any    `json:"details,omitempty"`
}

type ComponentSummary struct {
	ComponentKey      ComponentKey      `json:"component_key"`
	Label             string            `json:"label"`
	TemplateKind      TemplateKind      `json:"template_kind"`
	InstalledState    InstalledState    `json:"installed_state"`
	DetectedVersion   string            `json:"detected_version,omitempty"`
	PackagedVersion   string            `json:"packaged_version,omitempty"`
	VerificationState VerificationState `json:"verification_state"`
	AvailableActions  []Action          `json:"available_actions,omitempty"`
	LastAction        *LastAction       `json:"last_action,omitempty"`
}

type ComponentDetail struct {
	ComponentSummary
	ServiceName  string              `json:"service_name,omitempty"`
	BinaryPath   string              `json:"binary_path,omitempty"`
	ConfigPath   string              `json:"config_path,omitempty"`
	Preflight    *PreflightResult    `json:"preflight,omitempty"`
	Verification *VerificationResult `json:"verification,omitempty"`
}

type ActionResponse struct {
	ComponentKey      ComponentKey      `json:"component_key"`
	Action            Action            `json:"action"`
	Result            string            `json:"result"`
	InstalledState    InstalledState    `json:"installed_state"`
	DetectedVersion   string            `json:"detected_version,omitempty"`
	PackagedVersion   string            `json:"packaged_version,omitempty"`
	VerificationState VerificationState `json:"verification_state"`
	Message           string            `json:"message,omitempty"`
	Output            string            `json:"output,omitempty"`
}

type Operation struct {
	OperationID    string         `json:"operation_id"`
	ServerID       string         `json:"server_id"`
	Capability     Capability     `json:"capability"`
	ComponentKey   ComponentKey   `json:"component_key"`
	Action         Action         `json:"action"`
	Phase          OperationPhase `json:"phase"`
	TerminalStatus TerminalStatus `json:"terminal_status"`
	FailureReason  string         `json:"failure_reason,omitempty"`
	CreatedAt      string         `json:"created_at"`
	UpdatedAt      string         `json:"updated_at"`
}

type AsyncCommandResponse struct {
	Accepted    bool           `json:"accepted"`
	OperationID string         `json:"operation_id,omitempty"`
	Phase       OperationPhase `json:"phase,omitempty"`
	Message     string         `json:"message,omitempty"`
}