package service

import (
	"context"
	"fmt"
	"time"

	"github.com/websoft9/appos/backend/domain/software"
	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
)

type SupportedServerCatalogEntry struct {
	ComponentKey           software.ComponentKey                            `json:"component_key"`
	Label                  string                                           `json:"label"`
	Capability             software.Capability                              `json:"capability,omitempty"`
	SupportedActions       []software.Action                                `json:"supported_actions"`
	ActionTimeouts         map[software.Action]int                          `json:"action_timeouts,omitempty"`
	TimeoutPolicy          map[software.Action]software.TimeoutPolicyResult `json:"timeout_policy,omitempty"`
	TemplateKind           software.TemplateKind                            `json:"template_kind"`
	ArtifactKind           software.ArtifactKind                            `json:"artifact_kind,omitempty"`
	ServiceName            string                                           `json:"service_name,omitempty"`
	Description            string                                           `json:"description"`
	ReadinessRequirements  []string                                         `json:"readiness_requirements"`
	RequiresAppOSBaseURL   bool                                             `json:"requires_appos_base_url,omitempty"`
	FavoriteSystemdService bool                                             `json:"favorite_systemd_service,omitempty"`
	Visibility             []software.CatalogVisibility                     `json:"visibility"`
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
			ComponentKey:           entry.ComponentKey,
			Label:                  entry.Label,
			Capability:             capability,
			SupportedActions:       entry.SupportedActions,
			ActionTimeouts:         supportedActionTimeouts(resolved),
			TimeoutPolicy:          supportedTimeoutPolicy(resolved, entry.SupportedActions),
			TemplateKind:           resolved.TemplateKind,
			ArtifactKind:           software.EffectiveArtifactKind(entry, resolved.TemplateKind),
			ServiceName:            entry.ServiceName,
			Description:            entry.Description,
			ReadinessRequirements:  append([]string(nil), entry.ReadinessRequirements...),
			RequiresAppOSBaseURL:   entry.RequiresAppOSBaseURL,
			FavoriteSystemdService: entry.FavoriteSystemdService,
			Visibility:             append([]software.CatalogVisibility(nil), entry.Visibility...),
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

func supportedActionTimeouts(resolved software.ResolvedTemplate) map[software.Action]int {
	out := map[software.Action]int{}
	for _, action := range []software.Action{
		software.ActionInstall,
		software.ActionUpgrade,
		software.ActionStart,
		software.ActionStop,
		software.ActionRestart,
		software.ActionVerify,
		software.ActionReinstall,
		software.ActionUninstall,
	} {
		duration := resolved.ActionTimeouts.DurationFor(action)
		if duration <= 0 {
			continue
		}
		out[action] = int(duration / time.Second)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func supportedTimeoutPolicy(resolved software.ResolvedTemplate, actions []software.Action) map[software.Action]software.TimeoutPolicyResult {
	out := map[software.Action]software.TimeoutPolicyResult{}
	for _, action := range actions {
		if resolved.ActionTimeouts.DurationFor(action) <= 0 {
			continue
		}
		out[action] = resolved.ActionTimeoutPolicy.ResultFor(action)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
