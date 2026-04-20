// Package catalog loads and resolves Software Delivery component templates and catalogs.
//
// The catalog subdomain owns two static registries:
//   - templates.yaml: named delivery templates (detect, preflight, install, upgrade, verify, repair steps)
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

func validateCatalogEntries(cat software.ComponentCatalog, catalogName string) error {
	for _, entry := range cat.Components {
		if entry.ComponentKey.IsReservedRouteKey() {
			return fmt.Errorf("%s: component_key %q is reserved by the flat /software route family", catalogName, entry.ComponentKey)
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
// detect and verify actions only. Install, upgrade, and repair are not managed by Software Delivery
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
// the full Software Delivery lifecycle: install, upgrade, verify, and repair.
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

	repair := software.RepairSpec{Strategy: "reinstall"}
	if tpl.Repair != nil {
		repair = *tpl.Repair
	}

	return software.ResolvedTemplate{
		ComponentKey: entry.ComponentKey,
		TemplateRef:  entry.TemplateRef,
		TemplateKind: tpl.TemplateKind,
		Detect: software.DetectSpec{
			VersionCommand: sub(tpl.Detect.VersionCommand),
			InstalledHint:  subSlice(tpl.Detect.InstalledHint),
		},
		Preflight: tpl.Preflight,
		Install: software.InstallSpec{
			Strategy:    tpl.Install.Strategy,
			PackageName: sub(tpl.Install.PackageName),
			ScriptURL:   sub(tpl.Install.ScriptURL),
			Args:        subSlice(tpl.Install.Args),
		},
		Upgrade: software.UpgradeSpec{
			Strategy:    tpl.Upgrade.Strategy,
			PackageName: sub(tpl.Upgrade.PackageName),
			ScriptURL:   sub(tpl.Upgrade.ScriptURL),
			Args:        subSlice(tpl.Upgrade.Args),
		},
		Verify: software.VerifySpec{
			Strategy:    tpl.Verify.Strategy,
			ServiceName: sub(tpl.Verify.ServiceName),
		},
		Repair:         repair,
		DefaultActions: entry.DefaultActions,
	}
}
