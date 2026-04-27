package service

import (
	"context"
	"fmt"

	"github.com/websoft9/appos/backend/domain/software"
	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
)

type SupportedServerCatalogEntry struct {
	ComponentKey          software.ComponentKey        `json:"component_key"`
	Label                 string                       `json:"label"`
	Capability            software.Capability         `json:"capability,omitempty"`
	SupportedActions      []software.Action            `json:"supported_actions"`
	TemplateKind          software.TemplateKind        `json:"template_kind"`
	Description           string                       `json:"description"`
	ReadinessRequirements []string                     `json:"readiness_requirements"`
	Visibility            []software.CatalogVisibility `json:"visibility"`
}

func (s *Service) ListSupportedServerCatalog(_ context.Context) ([]SupportedServerCatalogEntry, error) {
	cat, reg, err := loadCatalogAndRegistry(true)
	if err != nil {
		return nil, err
	}

	items := make([]SupportedServerCatalogEntry, 0, len(cat.Components))
	for _, entry := range cat.Components {
		tpl, ok := reg.Templates[entry.TemplateRef]
		if !ok {
			return nil, fmt.Errorf("template ref not found: %s", entry.TemplateRef)
		}
		resolved := swcatalog.ResolveTemplate(entry, tpl)
		capability := entry.Capability
		mappedCapability := capabilityForComponent(entry.ComponentKey)
		if capability == "" {
			capability = mappedCapability
		}
		if mappedCapability != "" && capability != mappedCapability {
			return nil, fmt.Errorf("catalog capability mismatch for %s: catalog=%s map=%s", entry.ComponentKey, capability, mappedCapability)
		}
		items = append(items, SupportedServerCatalogEntry{
			ComponentKey:          entry.ComponentKey,
			Label:                 entry.Label,
			Capability:            capability,
			SupportedActions:      entry.SupportedActions,
			TemplateKind:          resolved.TemplateKind,
			Description:           entry.Description,
			ReadinessRequirements: append([]string(nil), entry.ReadinessRequirements...),
			Visibility:            append([]software.CatalogVisibility(nil), entry.Visibility...),
		})
	}

	return items, nil
}

func (s *Service) GetSupportedServerCatalogEntry(ctx context.Context, componentKey software.ComponentKey) (SupportedServerCatalogEntry, error) {
	items, err := s.ListSupportedServerCatalog(ctx)
	if err != nil {
		return SupportedServerCatalogEntry{}, err
	}
	for _, item := range items {
		if item.ComponentKey == componentKey {
			return item, nil
		}
	}
	return SupportedServerCatalogEntry{}, fmt.Errorf("component %q not found in supported server catalog", componentKey)
}

func capabilityForComponent(componentKey software.ComponentKey) software.Capability {
	for capability, mappedKey := range software.CapabilityComponentMap {
		if mappedKey == componentKey {
			return capability
		}
	}
	return ""
}
