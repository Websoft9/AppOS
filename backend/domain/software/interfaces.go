package software

import "context"

// CapabilityStatus is the readiness summary exposed by the cross-domain query interface.
type CapabilityStatus struct {
	Capability      Capability            `json:"capability"`
	ComponentKey    ComponentKey          `json:"component_key"`
	InstalledState  InstalledState        `json:"installed_state"`
	Ready           bool                  `json:"ready"`
	ReadinessResult TargetReadinessResult `json:"readiness"`
}

// CapabilityQuerier is the read-side cross-domain interface for Software Delivery.
//
// External domains (Deploy, Monitor, Gateway) must use this interface to inspect
// capability status without depending on component-level implementation details.
//
// All methods are synchronous and safe to call in request context.
type CapabilityQuerier interface {
	// ListCapabilities returns readiness status for all managed capabilities on a server.
	ListCapabilities(ctx context.Context, serverID string) ([]CapabilityStatus, error)

	// GetCapabilityStatus returns readiness status for one named capability.
	GetCapabilityStatus(ctx context.Context, serverID string, capability Capability) (CapabilityStatus, error)

	// IsCapabilityReady returns true when the capability is installed, verified, and all
	// readiness dimensions (OS, privilege, network, dependency) are satisfied.
	IsCapabilityReady(ctx context.Context, serverID string, capability Capability) (bool, error)
}

// CapabilityCommander is the write-side cross-domain interface for Software Delivery.
//
// External domains must use this interface to issue async capability commands.
// All methods return an AsyncCommandResponse with an operation_id that callers
// can use to poll operation status.
type CapabilityCommander interface {
	// EnsureCapability installs the component backing a capability if not already installed,
	// or re-converges it if it is degraded. Idempotent for already-healthy capabilities.
	EnsureCapability(ctx context.Context, serverID string, capability Capability) (AsyncCommandResponse, error)

	// UpgradeCapability upgrades the installed component to the packaged version.
	UpgradeCapability(ctx context.Context, serverID string, capability Capability) (AsyncCommandResponse, error)

	// VerifyCapability runs a verification pass on the installed component and updates
	// the readiness projection. Safe to call on any installed component.
	VerifyCapability(ctx context.Context, serverID string, capability Capability) (AsyncCommandResponse, error)
}

// TemplateResolver maps a ComponentKey to a fully resolved ResolvedTemplate.
//
// Implementations look up the catalog entry for the given key, fetch its referenced
// template from the registry, and substitute all {{placeholder}} values from catalog
// metadata. No user-supplied values enter the resolution pipeline.
type TemplateResolver interface {
	// Resolve returns the fully resolved template for a component key.
	// Returns an error if the component key is unknown or its template_ref is not registered.
	Resolve(key ComponentKey) (ResolvedTemplate, error)
}

// ComponentExecutor runs the four template-driven execution flows against a target host.
//
// All methods accept a ResolvedTemplate (produced by TemplateResolver) and return
// a SoftwareComponentDetail reflecting the component state after execution.
// Implementations must be idempotent: calling Install or Repair on a component that
// is already in a healthy installed state must not fail or degrade the component.
type ComponentExecutor interface {
	// Detect runs the detection step and returns the current installed state and version.
	Detect(ctx context.Context, serverID string, tpl ResolvedTemplate) (InstalledState, string, error)

	// RunPreflight executes all preflight checks and returns a TargetReadinessResult.
	// A non-ok result does not indicate an executor error; the caller decides whether to proceed.
	RunPreflight(ctx context.Context, serverID string, tpl ResolvedTemplate) (TargetReadinessResult, error)

	// Install executes the install step then verify, and returns the resulting component detail.
	// Idempotent: if the component is already installed and healthy, returns the current state.
	Install(ctx context.Context, serverID string, tpl ResolvedTemplate) (SoftwareComponentDetail, error)

	// Upgrade executes the upgrade step then verify, and returns the resulting component detail.
	Upgrade(ctx context.Context, serverID string, tpl ResolvedTemplate) (SoftwareComponentDetail, error)

	// Verify executes the verify step and returns the current component state.
	Verify(ctx context.Context, serverID string, tpl ResolvedTemplate) (SoftwareComponentDetail, error)

	// Repair re-executes the install step then verify, and returns the resulting component detail.
	// If the component is already healthy, returns the current healthy state unchanged.
	Repair(ctx context.Context, serverID string, tpl ResolvedTemplate) (SoftwareComponentDetail, error)
}
