package catalog_test

import (
	"strings"
	"testing"

	"github.com/websoft9/appos/backend/domain/software"
	"github.com/websoft9/appos/backend/domain/software/catalog"
)

// ── Template type compilation tests ──────────────────────────────────────────

// TestTemplateSchemaTypes verifies that ComponentTemplate and related types compile.
func TestTemplateSchemaTypes(t *testing.T) {
	var tpl software.ComponentTemplate
	if tpl.TemplateKind != "" {
		t.Error("zero value TemplateKind should be empty")
	}
	var entry software.CatalogEntry
	if entry.ComponentKey != "" {
		t.Error("zero value ComponentKey should be empty")
	}
}

// ── Template registry tests ───────────────────────────────────────────────────

// TestLoadTemplateRegistry verifies that the embedded templates.yaml loads without error
// and contains all five expected templates.
func TestLoadTemplateRegistry(t *testing.T) {
	reg, err := catalog.LoadTemplateRegistry()
	if err != nil {
		t.Fatalf("LoadTemplateRegistry: %v", err)
	}
	for _, name := range []string{"package-systemd", "script-systemd", "binary-supervisor", "binary-detect"} {
		if _, ok := reg.Templates[name]; !ok {
			t.Errorf("expected %q template in registry", name)
		}
	}
}

// TestReinstallStepPresent verifies all templates declare a reinstall step (even if strategy is empty).
func TestReinstallStepPresent(t *testing.T) {
	reg, err := catalog.LoadTemplateRegistry()
	if err != nil {
		t.Fatalf("LoadTemplateRegistry: %v", err)
	}
	for name, tpl := range reg.Templates {
		if tpl.Reinstall == nil {
			t.Errorf("template %q has no reinstall step", name)
		}
	}
}

// TestPreflightVerifiedOSNonEmpty verifies server templates declare at least one verified OS baseline.
// binary-supervisor and binary-detect are OS-agnostic by design (container-internal) and are skipped.
func TestPreflightVerifiedOSNonEmpty(t *testing.T) {
	reg, err := catalog.LoadTemplateRegistry()
	if err != nil {
		t.Fatalf("LoadTemplateRegistry: %v", err)
	}
	for name, tpl := range reg.Templates {
		if tpl.TemplateKind == software.TemplateKindBinary {
			continue // local detection templates are OS-agnostic by design
		}
		if len(tpl.Preflight.VerifiedOS) == 0 {
			t.Errorf("template %q has empty verified_os", name)
		}
	}
}

// ── Server catalog tests ──────────────────────────────────────────────────────

// TestLoadServerCatalogComponentKeys verifies that the server catalog contains
// all expected component keys.
func TestLoadServerCatalogComponentKeys(t *testing.T) {
	cat, err := catalog.LoadServerCatalog()
	if err != nil {
		t.Fatalf("LoadServerCatalog: %v", err)
	}
	if len(cat.Components) != 3 {
		t.Errorf("expected 3 server components, got %d", len(cat.Components))
	}
	required := []software.ComponentKey{
		software.ComponentKeyDocker,
		software.ComponentKeyReverseProxy,
		software.ComponentKeyMonitorAgent,
	}
	found := make(map[software.ComponentKey]bool)
	for _, e := range cat.Components {
		found[e.ComponentKey] = true
	}
	for _, key := range required {
		if !found[key] {
			t.Errorf("server catalog missing required component key %q", key)
		}
	}
	for key := range found {
		if key.IsReservedRouteKey() {
			t.Errorf("server catalog uses reserved flat-route component key %q", key)
		}
	}
}

// TestServerCatalogEntriesHaveTargetTypeServer verifies that all server catalog entries
// carry target_type: server.
func TestServerCatalogEntriesHaveTargetTypeServer(t *testing.T) {
	cat, err := catalog.LoadServerCatalog()
	if err != nil {
		t.Fatalf("LoadServerCatalog: %v", err)
	}
	for _, entry := range cat.Components {
		if entry.TargetType != software.TargetTypeServer {
			t.Errorf("server catalog entry %q has target_type=%q, want %q",
				entry.ComponentKey, entry.TargetType, software.TargetTypeServer)
		}
	}
}

// TestServerCatalogEntriesHaveValidTemplateRefs verifies that every server catalog entry
// references a template that actually exists in the template registry.
func TestServerCatalogEntriesHaveValidTemplateRefs(t *testing.T) {
	cat, err := catalog.LoadServerCatalog()
	if err != nil {
		t.Fatalf("LoadServerCatalog: %v", err)
	}
	reg, err := catalog.LoadTemplateRegistry()
	if err != nil {
		t.Fatalf("LoadTemplateRegistry: %v", err)
	}
	for _, entry := range cat.Components {
		if _, ok := reg.Templates[entry.TemplateRef]; !ok {
			t.Errorf("server catalog entry %q references unknown template_ref %q", entry.ComponentKey, entry.TemplateRef)
		}
	}
}

// TestServerCatalogSupportedActionsAreValid verifies that all supported_actions in server catalog
// entries use known Action constants.
func TestServerCatalogSupportedActionsAreValid(t *testing.T) {
	cat, err := catalog.LoadServerCatalog()
	if err != nil {
		t.Fatalf("LoadServerCatalog: %v", err)
	}
	validActions := map[software.Action]bool{
		software.ActionInstall:   true,
		software.ActionUpgrade:   true,
		software.ActionStart:     true,
		software.ActionStop:      true,
		software.ActionRestart:   true,
		software.ActionVerify:    true,
		software.ActionReinstall: true,
		software.ActionUninstall: true,
	}
	for _, entry := range cat.Components {
		for _, a := range entry.SupportedActions {
			if !validActions[a] {
				t.Errorf("server catalog entry %q has invalid action %q", entry.ComponentKey, a)
			}
		}
	}
}

// TestServerCatalogCapabilityComponentMapConsistency verifies that every ComponentKey in
// CapabilityComponentMap is present in the server catalog.
func TestServerCatalogCapabilityComponentMapConsistency(t *testing.T) {
	cat, err := catalog.LoadServerCatalog()
	if err != nil {
		t.Fatalf("LoadServerCatalog: %v", err)
	}
	catalogKeys := make(map[software.ComponentKey]bool)
	for _, e := range cat.Components {
		catalogKeys[e.ComponentKey] = true
	}
	for cap, key := range software.CapabilityComponentMap {
		if !catalogKeys[key] {
			t.Errorf("CapabilityComponentMap[%q]=%q not found in server catalog", cap, key)
		}
	}
}

// TestServerCatalogDeclaredCapabilitiesAreInCanonicalMap verifies the reverse invariant:
// every server catalog entry that declares a capability must be present in CapabilityComponentMap
// with the same component key.
func TestServerCatalogDeclaredCapabilitiesAreInCanonicalMap(t *testing.T) {
	cat, err := catalog.LoadServerCatalog()
	if err != nil {
		t.Fatalf("LoadServerCatalog: %v", err)
	}
	for _, entry := range cat.Components {
		if entry.Capability == "" {
			continue
		}
		mappedKey, ok := software.CapabilityComponentMap[entry.Capability]
		if !ok {
			t.Errorf("server catalog entry %q declares capability %q that is absent from CapabilityComponentMap", entry.ComponentKey, entry.Capability)
			continue
		}
		if mappedKey != entry.ComponentKey {
			t.Errorf("server catalog entry %q declares capability %q but CapabilityComponentMap points to %q", entry.ComponentKey, entry.Capability, mappedKey)
		}
	}
}

// TestServerCatalogEntriesHaveRequiredFields verifies that every server catalog entry has
// a non-empty label, template_ref, and binary field.
func TestServerCatalogEntriesHaveRequiredFields(t *testing.T) {
	cat, err := catalog.LoadServerCatalog()
	if err != nil {
		t.Fatalf("LoadServerCatalog: %v", err)
	}
	for _, entry := range cat.Components {
		if entry.Label == "" {
			t.Errorf("server catalog entry %q has empty label", entry.ComponentKey)
		}
		if entry.TemplateRef == "" {
			t.Errorf("server catalog entry %q has empty template_ref", entry.ComponentKey)
		}
		if entry.Binary == "" {
			t.Errorf("server catalog entry %q has empty binary", entry.ComponentKey)
		}
		if len(entry.SupportedActions) == 0 {
			t.Errorf("server catalog entry %q has no supported_actions", entry.ComponentKey)
		}
		if entry.Description == "" {
			t.Errorf("server catalog entry %q has empty description", entry.ComponentKey)
		}
		if len(entry.ReadinessRequirements) == 0 {
			t.Errorf("server catalog entry %q has no readiness_requirements", entry.ComponentKey)
		}
		if len(entry.Visibility) == 0 {
			t.Errorf("server catalog entry %q has no visibility metadata", entry.ComponentKey)
		}
	}
}

func TestServerCatalogVisibilityIncludesDiscovery(t *testing.T) {
	cat, err := catalog.LoadServerCatalog()
	if err != nil {
		t.Fatalf("LoadServerCatalog: %v", err)
	}
	for _, entry := range cat.Components {
		found := false
		for _, visibility := range entry.Visibility {
			if visibility == software.CatalogVisibilitySupportedSoftwareDiscovery {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("server catalog entry %q must be visible in supported-software discovery", entry.ComponentKey)
		}
	}
}

// TestServerCatalogCanResolveAllEntries verifies that every server catalog entry can be
// resolved to a ResolvedTemplate without unresolved placeholders.
func TestServerCatalogCanResolveAllEntries(t *testing.T) {
	cat, err := catalog.LoadServerCatalog()
	if err != nil {
		t.Fatalf("LoadServerCatalog: %v", err)
	}
	reg, err := catalog.LoadTemplateRegistry()
	if err != nil {
		t.Fatalf("LoadTemplateRegistry: %v", err)
	}
	for _, entry := range cat.Components {
		tpl, ok := reg.Templates[entry.TemplateRef]
		if !ok {
			t.Errorf("entry %q: template_ref %q not found", entry.ComponentKey, entry.TemplateRef)
			continue
		}
		resolved := catalog.ResolveTemplate(entry, tpl)
		if resolved.ComponentKey != entry.ComponentKey {
			t.Errorf("entry %q: resolved component_key mismatch", entry.ComponentKey)
		}
		if resolved.Detect.VersionCommand == "" {
			t.Errorf("entry %q: resolved detect.version_command is empty", entry.ComponentKey)
		}
	}
}

// ── Local catalog tests ───────────────────────────────────────────────────────

// TestLoadLocalCatalogHasEntries verifies that the local catalog loads without error
// and contains at least the expected local components.
func TestLoadLocalCatalogHasEntries(t *testing.T) {
	cat, err := catalog.LoadLocalCatalog()
	if err != nil {
		t.Fatalf("LoadLocalCatalog: %v", err)
	}
	if len(cat.Components) == 0 {
		t.Error("expected at least one local catalog entry")
	}
	for _, entry := range cat.Components {
		if entry.ComponentKey.IsReservedRouteKey() {
			t.Errorf("local catalog uses reserved flat-route component key %q", entry.ComponentKey)
		}
	}
}

// TestLocalCatalogEntriesHaveTargetTypeLocal verifies that all local catalog entries
// carry target_type: local.
func TestLocalCatalogEntriesHaveTargetTypeLocal(t *testing.T) {
	cat, err := catalog.LoadLocalCatalog()
	if err != nil {
		t.Fatalf("LoadLocalCatalog: %v", err)
	}
	for _, entry := range cat.Components {
		if entry.TargetType != software.TargetTypeLocal {
			t.Errorf("local catalog entry %q has target_type=%q, want %q",
				entry.ComponentKey, entry.TargetType, software.TargetTypeLocal)
		}
	}
}

// TestLocalCatalogSupportedActionsVerifyOnly verifies that local catalog entries only
// expose verify (no install, upgrade, reinstall, or uninstall) since these components are pre-installed.
func TestLocalCatalogSupportedActionsVerifyOnly(t *testing.T) {
	cat, err := catalog.LoadLocalCatalog()
	if err != nil {
		t.Fatalf("LoadLocalCatalog: %v", err)
	}
	for _, entry := range cat.Components {
		for _, a := range entry.SupportedActions {
			if a == software.ActionInstall || a == software.ActionUpgrade || a == software.ActionReinstall || a == software.ActionUninstall {
				t.Errorf("local catalog entry %q declares action %q; local entries should only expose verify",
					entry.ComponentKey, a)
			}
		}
	}
}

// TestLocalCatalogEntriesHaveValidTemplateRefs verifies that every local catalog entry
// references a template that actually exists.
func TestLocalCatalogEntriesHaveValidTemplateRefs(t *testing.T) {
	cat, err := catalog.LoadLocalCatalog()
	if err != nil {
		t.Fatalf("LoadLocalCatalog: %v", err)
	}
	reg, err := catalog.LoadTemplateRegistry()
	if err != nil {
		t.Fatalf("LoadTemplateRegistry: %v", err)
	}
	for _, entry := range cat.Components {
		if _, ok := reg.Templates[entry.TemplateRef]; !ok {
			t.Errorf("local catalog entry %q references unknown template_ref %q", entry.ComponentKey, entry.TemplateRef)
		}
	}
}

func TestLocalCatalogEntriesExposeCanonicalMetadata(t *testing.T) {
	cat, err := catalog.LoadLocalCatalog()
	if err != nil {
		t.Fatalf("LoadLocalCatalog: %v", err)
	}
	for _, entry := range cat.Components {
		if entry.Description == "" {
			t.Errorf("local catalog entry %q has empty description", entry.ComponentKey)
		}
		if len(entry.ReadinessRequirements) == 0 {
			t.Errorf("local catalog entry %q has no readiness_requirements", entry.ComponentKey)
		}
		if len(entry.Visibility) == 0 {
			t.Errorf("local catalog entry %q has no visibility metadata", entry.ComponentKey)
		}

		found := false
		for _, visibility := range entry.Visibility {
			if visibility == software.CatalogVisibilityLocalInventory {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("local catalog entry %q must be visible in local inventory", entry.ComponentKey)
		}
	}
}

// ── ResolveTemplate tests ─────────────────────────────────────────────────────

// TestResolveTemplatePlaceholders verifies that placeholder substitution works correctly
// for the docker server catalog entry, which uses the package-systemd template.
func TestResolveTemplatePlaceholders(t *testing.T) {
	reg, err := catalog.LoadTemplateRegistry()
	if err != nil {
		t.Fatalf("LoadTemplateRegistry: %v", err)
	}
	cat, err := catalog.LoadServerCatalog()
	if err != nil {
		t.Fatalf("LoadServerCatalog: %v", err)
	}

	var dockerEntry software.CatalogEntry
	for _, e := range cat.Components {
		if e.ComponentKey == software.ComponentKeyDocker {
			dockerEntry = e
			break
		}
	}
	if dockerEntry.ComponentKey == "" {
		t.Fatal("docker entry not found in server catalog")
	}

	tpl, ok := reg.Templates[dockerEntry.TemplateRef]
	if !ok {
		t.Fatalf("template_ref %q not found in registry", dockerEntry.TemplateRef)
	}
	resolved := catalog.ResolveTemplate(dockerEntry, tpl)

	if resolved.ComponentKey != software.ComponentKeyDocker {
		t.Errorf("expected component_key=docker, got %q", resolved.ComponentKey)
	}
	if strings.Contains(resolved.Detect.VersionCommand, "{{") {
		t.Errorf("detect version_command still has unresolved placeholder: %q", resolved.Detect.VersionCommand)
	}
	if strings.Contains(resolved.Install.PackageName, "{{") {
		t.Errorf("install package_name still has unresolved placeholder: %q", resolved.Install.PackageName)
	}
	if len(resolved.Install.PackageNames) != 5 {
		t.Fatalf("expected resolved install package_names for docker, got %v", resolved.Install.PackageNames)
	}
	if resolved.Install.PackageRepoProfile != "docker-ce" {
		t.Fatalf("expected docker package repo profile, got %q", resolved.Install.PackageRepoProfile)
	}
	if strings.Contains(resolved.Uninstall.PackageName, "{{") {
		t.Errorf("uninstall package_name still has unresolved placeholder: %q", resolved.Uninstall.PackageName)
	}
	if strings.Contains(resolved.Verify.ServiceName, "{{") {
		t.Errorf("verify service_name still has unresolved placeholder: %q", resolved.Verify.ServiceName)
	}
}

// TestResolveTemplateNoUserInput verifies that ResolveTemplate does not accept user-supplied
// values: all placeholders must come from the catalog entry.
func TestResolveTemplateNoUserInput(t *testing.T) {
	entry := software.CatalogEntry{
		ComponentKey: software.ComponentKeyDocker,
		TemplateRef:  "package-systemd",
		Binary:       "docker",
		ServiceName:  "docker.service",
		PackageName:  "docker.io",
	}
	tpl := software.ComponentTemplate{
		TemplateKind: software.TemplateKindPackage,
		Detect:       software.DetectSpec{VersionCommand: "{{binary}} --version"},
		Verify:       software.VerifySpec{ServiceName: "{{service_name}}"},
		Install:      software.InstallSpec{Strategy: "package", PackageName: "{{package_name}}"},
	}
	resolved := catalog.ResolveTemplate(entry, tpl)

	if resolved.Detect.VersionCommand != "docker --version" {
		t.Errorf("unexpected version command: %q", resolved.Detect.VersionCommand)
	}
	if resolved.Verify.ServiceName != "docker.service" {
		t.Errorf("unexpected service_name: %q", resolved.Verify.ServiceName)
	}
	if resolved.Install.PackageName != "docker.io" {
		t.Errorf("unexpected package_name: %q", resolved.Install.PackageName)
	}
}

// TestReinstallDefaultsToReinstall verifies that when a template has no reinstall step,
// ResolveTemplate defaults to the "reinstall" strategy.
func TestReinstallDefaultsToReinstall(t *testing.T) {
	entry := software.CatalogEntry{
		ComponentKey: software.ComponentKeyDocker,
		Binary:       "docker",
	}
	tpl := software.ComponentTemplate{
		TemplateKind: software.TemplateKindPackage,
		// Reinstall is nil intentionally
	}
	resolved := catalog.ResolveTemplate(entry, tpl)
	if resolved.Reinstall.Strategy != "reinstall" {
		t.Errorf("expected default reinstall strategy=reinstall, got %q", resolved.Reinstall.Strategy)
	}
}
