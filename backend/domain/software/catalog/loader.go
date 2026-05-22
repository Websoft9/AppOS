// Package catalog loads and resolves Software Delivery component templates and catalogs.
//
// The catalog subdomain owns two static registries:
//   - templates.yaml: named delivery templates (detect, preflight, install, upgrade, uninstall, verify, reinstall steps)
//   - catalog_local.yaml: components managed on the local AppOS host (detect + verify only)
//   - catalog_server.yaml: components deployed to managed remote servers (full lifecycle)
//
// All YAML files are compiled into the binary via go:embed. No user input reaches
// this package; all placeholder values originate from catalog metadata only.
package catalog

import (
	_ "embed"
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/websoft9/appos/backend/domain/software"
)

//go:embed templates.yaml
var embeddedTemplates []byte

//go:embed catalog_local.yaml
var embeddedLocalCatalog []byte

//go:embed catalog_server.yaml
var embeddedServerCatalog []byte

var validCatalogVisibility = map[software.CatalogVisibility]struct{}{
	software.CatalogVisibilityServerOperations:           {},
	software.CatalogVisibilitySupportedSoftwareDiscovery: {},
	software.CatalogVisibilityLocalInventory:             {},
}

func validateCatalogEntries(cat software.ComponentCatalog, catalogName string) error {
	for _, entry := range cat.Components {
		if entry.ComponentKey.IsReservedRouteKey() {
			return fmt.Errorf("%s: component_key %q is reserved by the flat /software route family", catalogName, entry.ComponentKey)
		}
		if entry.Label == "" {
			return fmt.Errorf("%s: component %q missing label", catalogName, entry.ComponentKey)
		}
		if entry.TemplateRef == "" {
			return fmt.Errorf("%s: component %q missing template_ref", catalogName, entry.ComponentKey)
		}
		if entry.Binary == "" {
			return fmt.Errorf("%s: component %q missing binary", catalogName, entry.ComponentKey)
		}
		if entry.Description == "" {
			return fmt.Errorf("%s: component %q missing description", catalogName, entry.ComponentKey)
		}
		seenLegacyServices := map[string]struct{}{}
		for _, legacyName := range entry.LegacyServiceNames {
			trimmed := strings.TrimSpace(legacyName)
			if trimmed == "" {
				return fmt.Errorf("%s: component %q has empty legacy_service_names entry", catalogName, entry.ComponentKey)
			}
			if trimmed == entry.ServiceName {
				return fmt.Errorf("%s: component %q legacy_service_names repeats current service_name %q", catalogName, entry.ComponentKey, entry.ServiceName)
			}
			if _, exists := seenLegacyServices[trimmed]; exists {
				return fmt.Errorf("%s: component %q duplicate legacy_service_names entry %q", catalogName, entry.ComponentKey, trimmed)
			}
			seenLegacyServices[trimmed] = struct{}{}
		}
		if len(entry.ReadinessRequirements) == 0 {
			return fmt.Errorf("%s: component %q missing readiness_requirements", catalogName, entry.ComponentKey)
		}
		if len(entry.Visibility) == 0 {
			return fmt.Errorf("%s: component %q missing visibility", catalogName, entry.ComponentKey)
		}
		for _, visibility := range entry.Visibility {
			if _, ok := validCatalogVisibility[visibility]; !ok {
				return fmt.Errorf("%s: component %q has unknown visibility %q", catalogName, entry.ComponentKey, visibility)
			}
		}
		if len(entry.SupportedActions) == 0 {
			return fmt.Errorf("%s: component %q missing supported_actions", catalogName, entry.ComponentKey)
		}
		if entry.Capability != "" {
			mappedKey, ok := software.CapabilityComponentMap[entry.Capability]
			if !ok {
				return fmt.Errorf("%s: component %q declares capability %q that is absent from CapabilityComponentMap", catalogName, entry.ComponentKey, entry.Capability)
			}
			if mappedKey != entry.ComponentKey {
				return fmt.Errorf("%s: component %q declares capability %q but CapabilityComponentMap points to %q", catalogName, entry.ComponentKey, entry.Capability, mappedKey)
			}
		}
	}
	return nil
}

// LoadTemplateRegistry parses the embedded templates.yaml and returns the full registry.
func LoadTemplateRegistry() (software.TemplateRegistry, error) {
	var reg software.TemplateRegistry
	if err := yaml.Unmarshal(embeddedTemplates, &reg); err != nil {
		return software.TemplateRegistry{}, fmt.Errorf("parse templates.yaml: %w", err)
	}
	return reg, nil
}

// LoadLocalCatalog parses the embedded catalog_local.yaml and returns the local-target catalog.
// Local catalog entries represent components installed on the AppOS host; they support
// detect and verify actions only. Install, upgrade, and reinstall are not managed by Software Delivery
// for local targets.
func LoadLocalCatalog() (software.ComponentCatalog, error) {
	var cat software.ComponentCatalog
	if err := yaml.Unmarshal(embeddedLocalCatalog, &cat); err != nil {
		return software.ComponentCatalog{}, fmt.Errorf("parse catalog_local.yaml: %w", err)
	}
	if err := validateCatalogEntries(cat, "catalog_local.yaml"); err != nil {
		return software.ComponentCatalog{}, err
	}
	return cat, nil
}

// LoadServerCatalog parses the embedded catalog_server.yaml and returns the server-target catalog.
// Server catalog entries represent components deployed to managed remote servers and support
// the full Software Delivery lifecycle: install, upgrade, uninstall, verify, and reinstall.
func LoadServerCatalog() (software.ComponentCatalog, error) {
	var cat software.ComponentCatalog
	if err := yaml.Unmarshal(embeddedServerCatalog, &cat); err != nil {
		return software.ComponentCatalog{}, fmt.Errorf("parse catalog_server.yaml: %w", err)
	}
	if err := validateCatalogEntries(cat, "catalog_server.yaml"); err != nil {
		return software.ComponentCatalog{}, err
	}
	return cat, nil
}

// ResolveTemplate builds a ResolvedTemplate by substituting all {{placeholder}} values
// in the template spec with actual values from the catalog entry.
//
// Security: placeholder values are sourced exclusively from catalog metadata, which
// is compiled into the binary. No user-supplied input reaches this function.
func ResolveTemplate(entry software.CatalogEntry, tpl software.ComponentTemplate) software.ResolvedTemplate {
	vars := map[string]string{
		"binary":       entry.Binary,
		"package_name": entry.PackageName,
		"service_name": entry.ServiceName,
		"script_path":  entry.ScriptPath,
		"script_url":   entry.ScriptURL,
	}
	sub := func(s string) string {
		for k, v := range vars {
			s = strings.ReplaceAll(s, "{{"+k+"}}", v)
		}
		return s
	}
	subSlice := func(ss []string) []string {
		if len(ss) == 0 {
			return ss
		}
		out := make([]string, len(ss))
		for i, s := range ss {
			out[i] = sub(s)
		}
		return out
	}
	subMap := func(values map[string]string) map[string]string {
		if len(values) == 0 {
			return nil
		}
		out := make(map[string]string, len(values))
		for key, value := range values {
			out[key] = sub(value)
		}
		return out
	}

	reinstall := software.ReinstallSpec{Strategy: "reinstall"}
	if tpl.Reinstall != nil {
		reinstall = *tpl.Reinstall
	}

	return software.ResolvedTemplate{
		ComponentKey: entry.ComponentKey,
		TemplateRef:  entry.TemplateRef,
		TemplateKind: tpl.TemplateKind,
		Detect: software.DetectSpec{
			VersionCommand: func() string {
				if entry.VersionCommand != "" {
					return entry.VersionCommand
				}
				return sub(tpl.Detect.VersionCommand)
			}(),
			InstalledHint: subSlice(tpl.Detect.InstalledHint),
		},
		Preflight:           tpl.Preflight,
		ActionTimeouts:      tpl.ActionTimeouts,
		ActionTimeoutPolicy: tpl.ActionTimeoutPolicy,
		Install: software.InstallSpec{
			Strategy:           tpl.Install.Strategy,
			PackageName:        sub(tpl.Install.PackageName),
			PackageNames:       append([]string(nil), entry.PackageNames...),
			PackageRepoProfile: entry.PackageRepoProfile,
			ScriptPath:         sub(tpl.Install.ScriptPath),
			ScriptURL:          sub(tpl.Install.ScriptURL),
			Env:                subMap(tpl.Install.Env),
			Args:               subSlice(tpl.Install.Args),
		},
		Upgrade: software.UpgradeSpec{
			Strategy:           tpl.Upgrade.Strategy,
			PackageName:        sub(tpl.Upgrade.PackageName),
			PackageNames:       append([]string(nil), entry.PackageNames...),
			PackageRepoProfile: entry.PackageRepoProfile,
			ScriptPath:         sub(tpl.Upgrade.ScriptPath),
			ScriptURL:          sub(tpl.Upgrade.ScriptURL),
			Env:                subMap(tpl.Upgrade.Env),
			Args:               subSlice(tpl.Upgrade.Args),
		},
		Uninstall: software.UninstallSpec{
			Strategy:           tpl.Uninstall.Strategy,
			PackageName:        sub(tpl.Uninstall.PackageName),
			PackageNames:       append([]string(nil), entry.PackageNames...),
			PackageRepoProfile: entry.PackageRepoProfile,
			ScriptPath:         sub(tpl.Uninstall.ScriptPath),
			ScriptURL:          sub(tpl.Uninstall.ScriptURL),
			Env:                subMap(tpl.Uninstall.Env),
			Args:               subSlice(tpl.Uninstall.Args),
		},
		Verify: software.VerifySpec{
			Strategy:    tpl.Verify.Strategy,
			ServiceName: sub(tpl.Verify.ServiceName),
		},
		Reinstall:        reinstall,
		SupportedActions: entry.SupportedActions,
	}
}
