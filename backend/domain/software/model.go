package software

import "strings"

type TemplateKind string

const (
	TemplateKindPackage TemplateKind = "package"
	TemplateKindScript  TemplateKind = "script"
	TemplateKindBinary  TemplateKind = "binary"
)

type ComponentKey string

var reservedSoftwareRouteKeys = map[string]struct{}{
	"capabilities": {},
	"operations":   {},
}

const (
	// Server-target components — referenced by CapabilityComponentMap and provisioning logic.
	ComponentKeyDocker       ComponentKey = "docker"
	ComponentKeyMonitorAgent ComponentKey = "monitor-agent"
	ComponentKeyReverseProxy ComponentKey = "reverse-proxy"
	// Local-target components are purely catalog-data-driven: their component_key strings
	// are defined in catalog/catalog_local.yaml and flow through the system as opaque values.
	// No Go constants are needed here unless code logic must reference a specific key.
)

func (k ComponentKey) IsReservedRouteKey() bool {
	_, exists := reservedSoftwareRouteKeys[strings.ToLower(string(k))]
	return exists
}

type Capability string

const (
	CapabilityContainerRuntime Capability = "container_runtime"
	CapabilityMonitorAgent     Capability = "monitor_agent"
	CapabilityReverseProxy     Capability = "reverse_proxy"
)

type CatalogVisibility string

const (
	CatalogVisibilityServerOperations           CatalogVisibility = "server_operations"
	CatalogVisibilitySupportedSoftwareDiscovery CatalogVisibility = "supported_software_discovery"
	CatalogVisibilityLocalInventory             CatalogVisibility = "local_inventory"
)

type InstalledState string

const (
	InstalledStateInstalled    InstalledState = "installed"
	InstalledStateNotInstalled InstalledState = "not_installed"
	InstalledStateUnknown      InstalledState = "unknown"
)

type InstallSource string

const (
	InstallSourceManaged        InstallSource = "managed"
	InstallSourceForeignPackage InstallSource = "foreign_package"
	InstallSourceManual         InstallSource = "manual"
	InstallSourceUnknown        InstallSource = "unknown"
)

type VerificationState string

const (
	VerificationStateHealthy  VerificationState = "healthy"
	VerificationStateDegraded VerificationState = "degraded"
	VerificationStateUnknown  VerificationState = "unknown"
)

type Action string

const (
	ActionInstall   Action = "install"
	ActionUpgrade   Action = "upgrade"
	ActionStart     Action = "start"
	ActionStop      Action = "stop"
	ActionRestart   Action = "restart"
	ActionVerify    Action = "verify"
	ActionReinstall Action = "reinstall"
	ActionUninstall Action = "uninstall"
)

// TargetType identifies the delivery target class for a software component.
// Software Delivery manages static component state for both target types.
type TargetType string

const (
	// TargetTypeLocal is the AppOS runtime install: components built into or
	// installed alongside the running AppOS container (nginx, redis, docker, etc.).
	// Static state only — version detection and availability. Runtime service
	// observation (supervisord, health metrics) belongs to Monitor.
	TargetTypeLocal TargetType = "local"

	// TargetTypeServer is a managed remote server registered in the server catalog.
	// Software Delivery owns install, upgrade, verify, and reinstall workflows for
	// all components on server targets.
	TargetTypeServer TargetType = "server"
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
	TerminalStatusNone              TerminalStatus = "none"
	TerminalStatusSuccess           TerminalStatus = "success"
	TerminalStatusFailed            TerminalStatus = "failed"
	TerminalStatusAttentionRequired TerminalStatus = "attention_required"
)

type FailureCode string

const (
	FailureCodeEnqueueError           FailureCode = "enqueue_error"
	FailureCodePreflightError         FailureCode = "preflight_error"
	FailureCodePreflightBlocked       FailureCode = "preflight_blocked"
	FailureCodeExecutionError         FailureCode = "execution_error"
	FailureCodeVerificationDegraded   FailureCode = "verification_degraded"
	FailureCodeVerificationError      FailureCode = "verification_error"
	FailureCodeUninstallTruthMismatch FailureCode = "uninstall_truth_mismatch"
)

const (
	AuditActionInstall   = "server.software.install"
	AuditActionUpgrade   = "server.software.upgrade"
	AuditActionStart     = "server.software.start"
	AuditActionStop      = "server.software.stop"
	AuditActionRestart   = "server.software.restart"
	AuditActionVerify    = "server.software.verify"
	AuditActionReinstall = "server.software.reinstall"
	AuditActionUninstall = "server.software.uninstall"
)

type SoftwareDeliveryLastAction struct {
	Action string `json:"action"`
	Result string `json:"result"`
	At     string `json:"at"`
}

type TargetReadinessResult struct {
	OK               bool     `json:"ok"`
	OSSupported      bool     `json:"os_supported"`
	PrivilegeOK      bool     `json:"privilege_ok"`
	NetworkOK        bool     `json:"network_ok"`
	DependencyReady  bool     `json:"dependency_ready"`
	ServiceManagerOK bool     `json:"service_manager_ok"`
	PackageManagerOK bool     `json:"package_manager_ok"`
	Issues           []string `json:"issues,omitempty"`
}

type SoftwareVerificationResult struct {
	State     VerificationState `json:"state"`
	CheckedAt string            `json:"checked_at"`
	Reason    string            `json:"reason,omitempty"`
	Details   map[string]any    `json:"details,omitempty"`
}

type DetectionResult struct {
	InstalledState  InstalledState `json:"installed_state"`
	DetectedVersion string         `json:"detected_version,omitempty"`
	InstallSource   InstallSource  `json:"install_source,omitempty"`
	SourceEvidence  string         `json:"source_evidence,omitempty"`
}

type SoftwareComponentSummary struct {
	ComponentKey      ComponentKey                `json:"component_key"`
	Label             string                      `json:"label"`
	TemplateKind      TemplateKind                `json:"template_kind"`
	InstalledState    InstalledState              `json:"installed_state"`
	DetectedVersion   string                      `json:"detected_version,omitempty"`
	InstallSource     InstallSource               `json:"install_source,omitempty"`
	SourceEvidence    string                      `json:"source_evidence,omitempty"`
	PackagedVersion   string                      `json:"packaged_version,omitempty"`
	VerificationState VerificationState           `json:"verification_state"`
	AvailableActions  []Action                    `json:"available_actions,omitempty"`
	LastAction        *SoftwareDeliveryLastAction `json:"last_action,omitempty"`
}

type SoftwareComponentDetail struct {
	SoftwareComponentSummary
	ServiceName  string                      `json:"service_name,omitempty"`
	BinaryPath   string                      `json:"binary_path,omitempty"`
	ConfigPath   string                      `json:"config_path,omitempty"`
	Preflight    *TargetReadinessResult      `json:"preflight,omitempty"`
	Verification *SoftwareVerificationResult `json:"verification,omitempty"`
}

type SoftwareActionResponse struct {
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

type SoftwareDeliveryOperation struct {
	OperationID    string         `json:"operation_id"`
	ServerID       string         `json:"server_id"`
	Capability     Capability     `json:"capability"`
	ComponentKey   ComponentKey   `json:"component_key"`
	Action         Action         `json:"action"`
	Phase          OperationPhase `json:"phase"`
	TerminalStatus TerminalStatus `json:"terminal_status"`
	FailurePhase   OperationPhase `json:"failure_phase,omitempty"`
	FailureCode    FailureCode    `json:"failure_code,omitempty"`
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

// ── Template schema types ─────────────────────────────────────────────────────

// DetectSpec defines how to detect whether a component is installed and its version.
type DetectSpec struct {
	VersionCommand string   `yaml:"version_command"`
	InstalledHint  []string `yaml:"installed_hint"`
}

// PreflightSpec defines readiness checks required before any action.
type PreflightSpec struct {
	RequireRoot    bool     `yaml:"require_root"`
	RequireNetwork bool     `yaml:"require_network"`
	VerifiedOS     []string `yaml:"verified_os"`
	ServiceManager string   `yaml:"service_manager"`
	PackageManager string   `yaml:"package_manager"`
}

// InstallSpec defines the install step.
type InstallSpec struct {
	Strategy           string            `yaml:"strategy"`
	PackageName        string            `yaml:"package_name"`
	PackageNames       []string          `yaml:"package_names"`
	PackageRepoProfile string            `yaml:"package_repo_profile"`
	ScriptPath         string            `yaml:"script_path"`
	ScriptURL          string            `yaml:"script_url"`
	Env                map[string]string `yaml:"env"`
	Args               []string          `yaml:"args"`
}

// UpgradeSpec defines the upgrade step.
type UpgradeSpec struct {
	Strategy           string            `yaml:"strategy"`
	PackageName        string            `yaml:"package_name"`
	PackageNames       []string          `yaml:"package_names"`
	PackageRepoProfile string            `yaml:"package_repo_profile"`
	ScriptPath         string            `yaml:"script_path"`
	ScriptURL          string            `yaml:"script_url"`
	Env                map[string]string `yaml:"env"`
	Args               []string          `yaml:"args"`
}

// UninstallSpec defines the uninstall step.
type UninstallSpec struct {
	Strategy           string            `yaml:"strategy"`
	PackageName        string            `yaml:"package_name"`
	PackageNames       []string          `yaml:"package_names"`
	PackageRepoProfile string            `yaml:"package_repo_profile"`
	ScriptPath         string            `yaml:"script_path"`
	ScriptURL          string            `yaml:"script_url"`
	Env                map[string]string `yaml:"env"`
	Args               []string          `yaml:"args"`
}

// VerifySpec defines the verify step.
type VerifySpec struct {
	Strategy    string `yaml:"strategy"`
	ServiceName string `yaml:"service_name"`
}

// ReinstallSpec defines how to reinstall a component.
// Strategy "reinstall" means: re-execute install then verify.
// Strategy "restart" means: restart the service via the system supervisor.
type ReinstallSpec struct {
	Strategy string `yaml:"strategy"`
}

// ComponentTemplate is a named, reusable delivery template.
// Each template defines a full set of execution steps that any compatible catalog
// entry can follow, substituting catalog-supplied placeholder values at resolve time.
type ComponentTemplate struct {
	TemplateKind TemplateKind  `yaml:"template_kind"`
	Detect       DetectSpec    `yaml:"detect"`
	Preflight    PreflightSpec `yaml:"preflight"`
	Install      InstallSpec   `yaml:"install"`
	Upgrade      UpgradeSpec   `yaml:"upgrade"`
	Uninstall    UninstallSpec `yaml:"uninstall"`
	Verify       VerifySpec    `yaml:"verify"`
	// Reinstall is optional in YAML. When absent, ResolveTemplate defaults to reinstall strategy.
	Reinstall *ReinstallSpec `yaml:"reinstall"`
}

// TemplateRegistry holds all named component templates keyed by template_ref string.
type TemplateRegistry struct {
	Templates map[string]ComponentTemplate `yaml:"templates"`
}

// CatalogEntry is one component record in the catalog.
// Placeholder fields (Binary, ServiceName, PackageName, ScriptURL) are injected
// into template specs by ResolveTemplate; they never originate from user input.
type CatalogEntry struct {
	ComponentKey          ComponentKey        `yaml:"component_key"`
	TargetType            TargetType          `yaml:"target_type"`
	Label                 string              `yaml:"label"`
	Capability            Capability          `yaml:"capability"`
	TemplateRef           string              `yaml:"template_ref"`
	Binary                string              `yaml:"binary"`
	ServiceName           string              `yaml:"service_name"`
	PackageName           string              `yaml:"package_name"`
	PackageNames          []string            `yaml:"package_names"`
	PackageRepoProfile    string              `yaml:"package_repo_profile"`
	ScriptPath            string              `yaml:"script_path"`
	ScriptURL             string              `yaml:"script_url"`
	Description           string              `yaml:"description"`
	ReadinessRequirements []string            `yaml:"readiness_requirements"`
	Visibility            []CatalogVisibility `yaml:"visibility"`
	SupportedActions      []Action            `yaml:"supported_actions"`
}

// ComponentCatalog holds all registered components.
type ComponentCatalog struct {
	Components []CatalogEntry `yaml:"components"`
}

// ResolvedTemplate is a CatalogEntry fused with its ComponentTemplate, with all
// {{placeholder}} values substituted from catalog metadata.
//
// ResolvedTemplate is the sole input type accepted by ComponentExecutor; no
// component-specific logic is permitted outside of this resolution step.
type ResolvedTemplate struct {
	ComponentKey     ComponentKey
	TemplateRef      string
	TemplateKind     TemplateKind
	Detect           DetectSpec
	Preflight        PreflightSpec
	Install          InstallSpec
	Upgrade          UpgradeSpec
	Uninstall        UninstallSpec
	Verify           VerifySpec
	Reinstall        ReinstallSpec
	SupportedActions []Action
}

// ── Readiness types ───────────────────────────────────────────────────────────

// ReadinessIssueCode is a machine-readable identifier for a blocking readiness condition.
type ReadinessIssueCode string

const (
	// ReadinessIssueOSNotSupported is returned when the target OS is outside the template's verified OS baseline.
	ReadinessIssueOSNotSupported ReadinessIssueCode = "os_not_supported"

	// ReadinessIssuePrivilegeRequired is returned when the template requires root but the target lacks it.
	ReadinessIssuePrivilegeRequired ReadinessIssueCode = "privilege_required"

	// ReadinessIssueNetworkRequired is returned when the template requires network access but it is unavailable.
	ReadinessIssueNetworkRequired ReadinessIssueCode = "network_required"

	// ReadinessIssueDependencyMissing is returned when a prerequisite capability is not yet available.
	ReadinessIssueDependencyMissing ReadinessIssueCode = "dependency_missing"

	// ReadinessIssueServiceManagerMissing is returned when the required service manager is unavailable.
	ReadinessIssueServiceManagerMissing ReadinessIssueCode = "service_manager_missing"

	// ReadinessIssuePackageManagerMissing is returned when the required package manager is unavailable.
	ReadinessIssuePackageManagerMissing ReadinessIssueCode = "package_manager_missing"
)

// TargetInfo captures the attributes of a delivery target that are required to evaluate
// readiness against a PreflightSpec.
//
// TargetInfo is produced by the infrastructure layer and must never be constructed from
// user-supplied HTTP inputs.
type TargetInfo struct {
	// OS is the canonical OS name of the target, e.g. "ubuntu", "debian", "rocky".
	OS string

	// HasRoot indicates whether the executor agent has root (or equivalent) privilege.
	HasRoot bool

	// NetworkOK indicates whether the required network path is currently reachable.
	NetworkOK bool

	// ServiceManager is the detected service supervisor/runtime, e.g. "systemd" or "supervisor".
	ServiceManager string

	// PackageManager is the detected package manager, e.g. "apt".
	PackageManager string
}
