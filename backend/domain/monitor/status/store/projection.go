package store

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

func LoadResourceCheckSummary(app core.App, targetType, targetID, checkKind, registryEntryID, resourceKind, templateID, endpoint string) map[string]any {
	return BuildResourceCheckSummary(LoadExistingSummary(app, targetType, targetID), checkKind, registryEntryID, resourceKind, templateID, endpoint)
}

func BuildResourceCheckSummary(summary map[string]any, checkKind, registryEntryID, resourceKind, templateID, endpoint string) map[string]any {
	summary = CloneSummary(summary)
	summary["check_kind"] = strings.TrimSpace(checkKind)
	summary["registry_entry_id"] = registryEntryID
	summary["resource_kind"] = resourceKind
	summary["template_id"] = templateID
	summary["endpoint"] = endpoint
	return summary
}
