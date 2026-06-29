package monitor

import (
	"strings"

	"github.com/websoft9/appos/backend/domain/resource/instances"
)

func MonitoringTargetRegistry() ([]TargetRegistryEntry, error) {
	if err := ensureTargetRegistryLoaded(); err != nil {
		return nil, err
	}
	result := make([]TargetRegistryEntry, len(targetRegistryEntries))
	copy(result, targetRegistryEntries)
	return result, nil
}

func ResolveInstanceTarget(item *instances.Instance) (ResolvedInstanceTarget, bool, error) {
	traits, err := instances.ResolveTraits(item)
	if err != nil {
		return ResolvedInstanceTarget{}, false, err
	}
	entry, ok, err := resolveTargetRegistryEntryWithTraits(TargetTypeResource, item.Kind(), item.TemplateID(), traits)
	if err != nil || !ok {
		return ResolvedInstanceTarget{}, ok, err
	}
	return ResolvedInstanceTarget{Entry: entry, Item: item}, true, nil
}

func ResolveTargetRegistryEntry(targetType, kind, templateID string) (TargetRegistryEntry, bool, error) {
	return resolveTargetRegistryEntryWithTraits(targetType, kind, templateID, nil)
}

func resolveTargetRegistryEntryWithTraits(targetType, kind, templateID string, traits []string) (TargetRegistryEntry, bool, error) {
	entries, err := MonitoringTargetRegistry()
	if err != nil {
		return TargetRegistryEntry{}, false, err
	}

	targetType = strings.TrimSpace(strings.ToLower(targetType))
	kind = strings.TrimSpace(strings.ToLower(kind))
	templateID = instances.NormalizeTemplateID(templateID)
	traits = normalizeStringSlice(traits)

	for _, entry := range entries {
		if !targetRegistryEntryMatches(entry, targetType, kind, templateID, nil) {
			continue
		}
		return entry, true, nil
	}

	for _, entry := range entries {
		if !targetRegistryEntryMatches(entry, targetType, kind, templateID, traits) {
			continue
		}
		if len(entry.Traits) == 0 {
			continue
		}
		return entry, true, nil
	}

	return TargetRegistryEntry{}, false, nil
}

func targetRegistryEntryMatches(entry TargetRegistryEntry, targetType, kind, templateID string, traits []string) bool {
	if entry.TargetType != targetType {
		return false
	}
	if entry.Kind != "" && entry.Kind != kind {
		return false
	}
	if len(entry.TemplateIDs) > 0 {
		if templateID == "" || !containsNormalized(entry.TemplateIDs, templateID) {
			return false
		}
	}
	if len(entry.Traits) > 0 {
		if len(traits) == 0 {
			return false
		}
		for _, trait := range entry.Traits {
			if !containsNormalized(traits, trait) {
				return false
			}
		}
	}
	return true
}
