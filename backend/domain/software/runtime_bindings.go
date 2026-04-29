package software

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingscatalog "github.com/websoft9/appos/backend/domain/config/sysconfig/catalog"
	"github.com/websoft9/appos/backend/domain/monitor"
	agentsignals "github.com/websoft9/appos/backend/domain/monitor/signals/agent"
)

const (
	softwareConfigModule            = "software"
	softwareConfigKey               = "config"
	apposAgentInstallerURLFieldName = "apposAgentInstallerUrl"
	apposAgentConfigEnvName         = "APPOS_AGENT_CONFIG_YAML"
	apposAgentSystemdUnitEnvName    = "APPOS_AGENT_SYSTEMD_UNIT"
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
	url := strings.TrimSpace(sysconfig.String(group, apposAgentInstallerURLFieldName, ""))
	if url != "" {
		return url
	}
	return strings.TrimSpace(sysconfig.String(defaults, apposAgentInstallerURLFieldName, ""))
}

func ApplyServerExecutionBindings(app core.App, serverID string, explicitBaseURL string, resolved ResolvedTemplate) ResolvedTemplate {
	if app == nil || strings.TrimSpace(serverID) == "" {
		return resolved
	}

	if resolved.ComponentKey != ComponentKeyAppOSAgent {
		return resolved
	}

	env := apposAgentManagedInstallEnv(app, serverID, explicitBaseURL)
	if len(env) == 0 {
		return resolved
	}

	resolved.Install.Env = mergeRuntimeEnv(resolved.Install.Env, env)
	resolved.Upgrade.Env = mergeRuntimeEnv(resolved.Upgrade.Env, env)
	return resolved
}

func apposAgentManagedInstallEnv(app core.App, serverID string, explicitBaseURL string) map[string]string {
	baseURL := effectiveAppOSBaseURL(app, explicitBaseURL)
	if baseURL == "" {
		return nil
	}
	token, _, err := agentsignals.GetOrIssueAgentToken(app, serverID, false)
	if err != nil || strings.TrimSpace(token) == "" {
		return nil
	}
	return map[string]string{
		apposAgentConfigEnvName:      apposAgentConfigYAML(serverID, baseURL, token),
		apposAgentSystemdUnitEnvName: apposAgentSystemdUnit(),
	}
}

func effectiveAppOSBaseURL(app core.App, explicitBaseURL string) string {
	if normalized := normalizeAppOSBaseURL(explicitBaseURL); normalized != "" {
		return normalized
	}
	if app == nil {
		return ""
	}
	current, err := app.Settings().Clone()
	if err != nil || current == nil {
		return ""
	}
	return normalizeAppOSBaseURL(current.Meta.AppURL)
}

func normalizeAppOSBaseURL(raw string) string {
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

func apposAgentConfigYAML(serverID string, baseURL string, token string) string {
	return fmt.Sprintf("server_id: %s\ninterval: %s\ningest_base_url: %s/api/monitor/ingest\ntoken: %s\ntimeout: 10s\n", serverID, monitor.ExpectedHeartbeatInterval, baseURL, token)
}

func apposAgentSystemdUnit() string {
	return "[Unit]\nDescription=AppOS Agent\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nExecStart=/usr/local/bin/appos-agent --config /etc/appos-agent.yaml\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=multi-user.target\n"
}

func mergeRuntimeEnv(existing map[string]string, injected map[string]string) map[string]string {
	if len(injected) == 0 {
		return existing
	}
	merged := make(map[string]string, len(existing)+len(injected))
	for key, value := range existing {
		merged[key] = value
	}
	for key, value := range injected {
		merged[key] = value
	}
	return merged
}
