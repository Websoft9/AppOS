// Package software implements the Software Delivery domain for AppOS.
//
// # Subdomain Boundary (Story 29.2)
//
// Software Delivery is divided into four internal subdomains:
//
//   - catalog        — what software AppOS manages (component identity, template refs)
//   - inventory      — what software is installed on each delivery target
//   - provisioning   — how software is installed, upgraded, verified, and reinstalled
//   - target-readiness — whether the target environment satisfies required capabilities
//
// # Target Types
//
// Software Delivery manages static component state for two delivery target types:
//
//   - local  — AppOS runtime install: components in the AppOS container (nginx,
//     redis, docker, supervisor). Static state: version and availability.
//   - server — managed remote servers registered in the server catalog.
//     Full workflow: install, upgrade, verify, reinstall.
//
// # Ownership Rules
//
// Software Delivery OWNS (for both target types):
//   - managed component identity (catalog)
//   - installed component inventory per target (inventory)
//   - install, upgrade, verify, and reinstall workflows (provisioning)
//   - OS, privilege, network, and dependency readiness checks (target-readiness)
//
// For ALL target types (local and server), the domain split is:
//
//	Software Delivery owns (regardless of whether the component is running):
//	  - installed component identity, version, and availability (inventory)
//	  - install, upgrade, verify, and reinstall workflows (provisioning)
//	  - OS, privilege, network, and dependency readiness checks (target-readiness)
//
//	Monitor owns (for the same software, only its runtime observation):
//	  - is it currently alive (active state via supervisord / systemd)
//	  - runtime health trend, uptime, CPU, memory, logs
//	  - active checks and health summaries
//	  - operator-facing status timelines and degraded-state visibility
//
// The split is: Software Delivery answers "what is installed and at what version",
// Monitor answers "is it running and is it healthy right now".
// Monitor is a CONSUMER of Software Delivery inventory events
// (SoftwareCapabilityReady, SoftwareCapabilityDegraded). It does not own
// or execute install, upgrade, or readiness workflows.
//
// # Current Code Mapping
//
// Existing code material maps to subdomains as follows:
//
//	backend/domain/components     → inventory  (installed state per server)
//	backend/domain/software     → catalog, provisioning, target-readiness
//
// # Audit Migration Note
//
// Prior to Story 29.2, audit action constants used the prefix "server.serverbase.*".
// They are now "server.software.*". If audit records were emitted before this change,
// a data migration may be needed to backfill the action names. No migration is
// required for a fresh install.
package software

// Subdomain identifies one of the four internal subdomains of Software Delivery.
type Subdomain string

const (
	// SubdomainCatalog owns component identity: what software AppOS manages,
	// template references, and display metadata.
	SubdomainCatalog Subdomain = "catalog"

	// SubdomainInventory owns the installed component snapshot for each delivery target.
	SubdomainInventory Subdomain = "inventory"

	// SubdomainProvisioning owns install, upgrade, verify, and reinstall workflows.
	SubdomainProvisioning Subdomain = "provisioning"

	// SubdomainTargetReadiness owns OS, privilege, network, and dependency readiness checks
	// that determine whether actions can safely run on a target.
	SubdomainTargetReadiness Subdomain = "target-readiness"
)

// MaterialSubdomainMap maps current code material keys to their target Software Delivery
// subdomain. This map encodes the boundary decision from Story 29.2 so it can be
// verified by tests and referenced during implementation.
// MaterialSubdomainMap maps current code material keys to their target Software Delivery
// subdomain. This map encodes the boundary decision from Story 29.2 so it can be
// verified by tests and referenced during implementation.
//
// NOTE: components.Service type (supervisord service records) is intentionally
// ABSENT from this map. Active service observation belongs to Monitor, not Software Delivery.
var MaterialSubdomainMap = map[string]Subdomain{
	// backend/domain/components — Component type: registry metadata and version/
	// availability detection output. Covers both local (AppOS runtime) and server targets.
	// components.Service type is NOT mapped here — it belongs to Monitor.
	"components.registry":         SubdomainCatalog,
	"components.inventory_output": SubdomainInventory,

	// backend/domain/software — install/upgrade/verify actions and preflight checks
	"software.install_upgrade_verify": SubdomainProvisioning,
	"software.os_privilege_network":   SubdomainTargetReadiness,
}

// CapabilityComponentMap is the canonical mapping from capability name to the
// component key that backs it. External domains must use capability names;
// they must not depend on component_key directly.
var CapabilityComponentMap = map[Capability]ComponentKey{
	CapabilityContainerRuntime: ComponentKeyDocker,
	CapabilityMonitorAgent:     ComponentKeyMonitorAgent,
	CapabilityReverseProxy:     ComponentKeyReverseProxy,
}
