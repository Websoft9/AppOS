package catalog

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/websoft9/appos/backend/domain/software"
)

func ProjectLocalCatalog(reg *LocalRegistry) (software.ComponentCatalog, error) {
	entries := make([]software.CatalogEntry, 0, len(reg.Components))
	for _, component := range reg.Components {
		if !component.Enabled || component.SoftwareCatalog == nil {
			continue
		}
		projection := component.SoftwareCatalog
		if strings.TrimSpace(string(projection.ComponentKey)) == "" {
			return software.ComponentCatalog{}, fmt.Errorf("component %q missing software_catalog.component_key", component.ID)
		}
		if len(projection.ReadinessRequirements) == 0 {
			return software.ComponentCatalog{}, fmt.Errorf("component %q missing software_catalog.readiness_requirements", component.ID)
		}

		serviceName := ""
		templateRef := "binary-detect"
		binary := deriveLocalCatalogBinary(component)
		if service, ok := reg.findEnabledServiceByComponentID(component.ID); ok {
			serviceName = service.Name
			if strings.EqualFold(strings.TrimSpace(service.Manager), "supervisor") {
				templateRef = "binary-supervisor"
			}
		}
		if strings.TrimSpace(binary) == "" {
			return software.ComponentCatalog{}, fmt.Errorf("component %q cannot derive software binary from runtime metadata", component.ID)
		}

		label := strings.TrimSpace(projection.Label)
		if label == "" {
			label = strings.TrimSpace(component.Name)
		}
		description := strings.TrimSpace(projection.Description)
		if description == "" {
			description = strings.TrimSpace(component.Notes)
		}
		if description == "" {
			return software.ComponentCatalog{}, fmt.Errorf("component %q has neither software_catalog.description nor notes", component.ID)
		}

		entries = append(entries, software.CatalogEntry{
			ComponentKey:          projection.ComponentKey,
			TargetType:            software.TargetTypeLocal,
			Label:                 label,
			Capability:            projection.Capability,
			ArtifactKind:          projection.ArtifactKind,
			TemplateRef:           templateRef,
			Binary:                binary,
			ServiceName:           serviceName,
			Description:           description,
			ReadinessRequirements: append([]string(nil), projection.ReadinessRequirements...),
			Visibility:            []software.CatalogVisibility{software.CatalogVisibilityLocalInventory},
			SupportedActions:      []software.Action{software.ActionVerify},
		})
	}

	cat := software.ComponentCatalog{Components: entries}
	if err := validateCatalogEntries(cat, "components_local.yaml"); err != nil {
		return software.ComponentCatalog{}, err
	}
	return cat, nil
}

func (r *LocalRegistry) findEnabledServiceByComponentID(componentID string) (LocalService, bool) {
	for _, service := range r.Services {
		if service.Enabled && service.ComponentID == componentID {
			return service, true
		}
	}
	return LocalService{}, false
}

func deriveLocalCatalogBinary(component LocalComponent) string {
	if path := strings.TrimSpace(component.UpdateProbe.Path); path != "" {
		base := strings.TrimSpace(filepath.Base(path))
		if base != "" && base != "." && base != string(filepath.Separator) {
			return base
		}
	}
	if component.VersionProbe.Type == "command" && len(component.VersionProbe.Command) > 0 {
		candidate := strings.TrimSpace(component.VersionProbe.Command[0])
		switch candidate {
		case "", "sh", "bash", "env":
		default:
			return candidate
		}
	}
	if component.AvailabilityProbe.Type == "command" && len(component.AvailabilityProbe.Command) > 0 {
		candidate := strings.TrimSpace(component.AvailabilityProbe.Command[0])
		switch candidate {
		case "", "sh", "bash", "env":
		default:
			return candidate
		}
	}
	return ""
}
