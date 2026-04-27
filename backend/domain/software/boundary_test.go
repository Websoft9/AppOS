package software

import "testing"

// TestSubdomainConstants verifies that every subdomain string value is stable
// and matches the documented boundary decision in Story 29.2.
func TestSubdomainConstants(t *testing.T) {
	cases := []struct {
		got  Subdomain
		want string
	}{
		{SubdomainCatalog, "catalog"},
		{SubdomainInventory, "inventory"},
		{SubdomainProvisioning, "provisioning"},
		{SubdomainTargetReadiness, "target-readiness"},
	}
	for _, c := range cases {
		if string(c.got) != c.want {
			t.Errorf("Subdomain: got %q, want %q", c.got, c.want)
		}
	}
}

// TestComponentMaterialMapping verifies that every current code material is
// classified to exactly one Software Delivery subdomain.
//
// This test encodes the boundary decisions from Story 29.2 so they cannot be
// silently broken by future cleanup.
func TestComponentMaterialMapping(t *testing.T) {
	expected := map[string]Subdomain{
		"components.registry":        SubdomainCatalog,
		"components.inventory_output": SubdomainInventory,
		"software.install_upgrade_verify": SubdomainProvisioning,
		"software.os_privilege_network":   SubdomainTargetReadiness,
	}

	for material, want := range expected {
		got, ok := MaterialSubdomainMap[material]
		if !ok {
			t.Errorf("MaterialSubdomainMap: missing key %q", material)
			continue
		}
		if got != want {
			t.Errorf("MaterialSubdomainMap[%q]: got %q, want %q", material, got, want)
		}
	}
}

// TestMonitorBoundaryIsNotOwner verifies that Monitor does not own any Software
// Delivery subdomain — it is a consumer, not an owner.
// It also verifies that components.Service-type concerns (active service observation)
// are not claimed by Software Delivery.
func TestMonitorBoundaryIsNotOwner(t *testing.T) {
	monitorConcerns := []string{
		"runtime_observation",
		"health_trend_projection",
		"heartbeat",
		"active_checks",
		"health_summaries",
		"status_timelines",
		// components.Service type belongs to Monitor, not Software Delivery
		"components.services",
		"components.active_service_state",
	}
	for _, concern := range monitorConcerns {
		if _, owned := MaterialSubdomainMap[concern]; owned {
			t.Errorf("Monitor concern %q must NOT be in MaterialSubdomainMap (Software Delivery does not own it)", concern)
		}
	}
}

// TestAuditConstantsUseSoftwarePrefix verifies the audit names use server.software.* prefix.
func TestAuditConstantsUseSoftwarePrefix(t *testing.T) {
	cases := []struct {
		got  string
		want string
	}{
		{AuditActionInstall, "server.software.install"},
		{AuditActionUpgrade, "server.software.upgrade"},
		{AuditActionVerify, "server.software.verify"},
		{AuditActionReinstall, "server.software.reinstall"},
		{AuditActionUninstall, "server.software.uninstall"},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("audit constant: got %q, want %q", c.got, c.want)
		}
	}
}

// TestCapabilityToComponentMapping confirms the canonical mapping from
// capability name to component key is stable.
func TestCapabilityToComponentMapping(t *testing.T) {
	cases := []struct {
		capability Capability
		component  ComponentKey
	}{
		{CapabilityContainerRuntime, ComponentKeyDocker},
		{CapabilityMonitorAgent, ComponentKeyMonitorAgent},
		{CapabilityControlPlane, ComponentKeyControlAgent},
		{CapabilityReverseProxy, ComponentKeyReverseProxy},
	}
	for _, c := range cases {
		got, ok := CapabilityComponentMap[c.capability]
		if !ok {
			t.Errorf("CapabilityComponentMap: missing capability %q", c.capability)
			continue
		}
		if got != c.component {
			t.Errorf("CapabilityComponentMap[%q]: got %q, want %q", c.capability, got, c.component)
		}
	}
}
