package software

// Domain event name constants for the Software Delivery domain.
//
// These event names are used when publishing domain events to the application
// event bus. External domains (Monitor, Deploy, Gateway) may subscribe to these
// events to refresh their own projections.
//
// Naming convention: software.<subject>.<verb-past>
const (
	// EventSoftwareCapabilityReady is published when a capability transitions to a ready state
	// (installed_state=installed, verification_state=healthy).
	EventSoftwareCapabilityReady = "software.capability.ready"

	// EventSoftwareCapabilityDegraded is published when capability verification returns degraded.
	EventSoftwareCapabilityDegraded = "software.capability.degraded"

	// EventSoftwareActionSucceeded is published when an install, upgrade, verify, or reinstall
	// action completes with terminal_status=success.
	EventSoftwareActionSucceeded = "software.action.succeeded"

	// EventSoftwareActionFailed is published when an install, upgrade, verify, or reinstall
	// action reaches terminal_status=failed.
	EventSoftwareActionFailed = "software.action.failed"
)
