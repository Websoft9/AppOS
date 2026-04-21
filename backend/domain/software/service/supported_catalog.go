package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/websoft9/appos/backend/domain/software"
	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
)

type SupportedServerCatalogEntry struct {
	ComponentKey     software.ComponentKey `json:"component_key"`
	Label            string                `json:"label"`
	Capability       string                `json:"capability,omitempty"`
	SupportedActions []software.Action     `json:"supported_actions"`
	TemplateKind     software.TemplateKind `json:"template_kind"`
	Description      string                `json:"description"`
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
		capability := capabilityForComponent(entry.ComponentKey)
		items = append(items, SupportedServerCatalogEntry{
			ComponentKey:     entry.ComponentKey,
			Label:            entry.Label,
			Capability:       string(capability),
			SupportedActions: entry.DefaultActions,
			TemplateKind:     resolved.TemplateKind,
			Description:      supportedCatalogDescription(entry, resolved.TemplateKind, capability),
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

func supportedCatalogDescription(entry software.CatalogEntry, templateKind software.TemplateKind, capability software.Capability) string {
	templateLabel := string(templateKind)
	if capability == "" {
		return fmt.Sprintf("%s is supported by AppOS as a server-target component using the %s delivery template.", entry.Label, templateLabel)
	}
	return fmt.Sprintf(
		"%s is supported by AppOS for the %s capability using the %s delivery template.",
		entry.Label,
		strings.ReplaceAll(string(capability), "_", " "),
		templateLabel,
	)
}
