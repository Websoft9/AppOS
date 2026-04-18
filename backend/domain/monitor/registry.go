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
	entry, ok, err := ResolveTargetRegistryEntry(TargetTypeResource, item.Kind(), item.TemplateID())
	if err != nil || !ok {
		return ResolvedInstanceTarget{}, ok, err
	}
	return ResolvedInstanceTarget{Entry: entry, Item: item}, true, nil
}

func ResolveTargetRegistryEntry(targetType, kind, templateID string) (TargetRegistryEntry, bool, error) {
	entries, err := MonitoringTargetRegistry()
	if err != nil {
		return TargetRegistryEntry{}, false, err
	}

	targetType = strings.TrimSpace(strings.ToLower(targetType))
	kind = strings.TrimSpace(strings.ToLower(kind))
	templateID = instances.NormalizeTemplateID(templateID)
	for _, entry := range entries {
		if entry.TargetType != targetType {
			continue
		}
		if entry.Kind != "" && entry.Kind != kind {
			continue
		}
		if len(entry.TemplateIDs) > 0 {
			if templateID == "" || !containsNormalized(entry.TemplateIDs, templateID) {
				continue
			}
		}
		return entry, true, nil
	}

	return TargetRegistryEntry{}, false, nil
}
