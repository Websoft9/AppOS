package software

import (
	"net/url"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingscatalog "github.com/websoft9/appos/backend/domain/config/sysconfig/catalog"
)

const (
	softwareConfigModule            = "software"
	softwareConfigKey               = "config"
	apposAgentInstallerURLFieldName = "apposAgentInstallerUrl"
)

func ApplyRuntimeBindings(app core.App, entry CatalogEntry) CatalogEntry {
	if app == nil {
		return entry
	}

	switch entry.ComponentKey {
	case ComponentKeyAppOSAgent:
		entry.ScriptURL = effectiveAppOSAgentInstallerURL(app)
	}

	return entry
}

func effectiveAppOSAgentInstallerURL(app core.App) string {
	defaults := settingscatalog.DefaultGroup(softwareConfigModule, softwareConfigKey)
	group, _ := sysconfig.GetGroup(app, softwareConfigModule, softwareConfigKey, defaults)
	return effectiveAppOSAgentInstallerURLFromGroup(group, defaults)
}

func effectiveAppOSAgentInstallerURLFromGroup(group, defaults map[string]any) string {
	url := strings.TrimSpace(sysconfig.String(group, apposAgentInstallerURLFieldName, ""))
	if url != "" {
		return url
	}
	return strings.TrimSpace(sysconfig.String(defaults, apposAgentInstallerURLFieldName, ""))
}

func NormalizeAppOSBaseURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	return strings.TrimRight(parsed.String(), "/")
}
