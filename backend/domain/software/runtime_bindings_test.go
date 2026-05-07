package software

import (
	"testing"

	settingscatalog "github.com/websoft9/appos/backend/domain/config/sysconfig/catalog"
)

func TestApplyRuntimeBindings_AppOSAgentUsesDefaultInstallerURL(t *testing.T) {
	defaults := settingscatalog.DefaultGroup(softwareConfigModule, softwareConfigKey)
	bound := CatalogEntry{ComponentKey: ComponentKeyAppOSAgent}
	bound.ScriptURL = effectiveAppOSAgentInstallerURLFromGroup(nil, defaults)
	if got, want := bound.ScriptURL, "https://artifact.websoft9.com/stable/appos/agent/appos-agent-install.sh"; got != want {
		t.Fatalf("expected default installer url %q, got %q", want, got)
	}
}

func TestApplyRuntimeBindings_AppOSAgentUsesCustomInstallerURL(t *testing.T) {
	defaults := settingscatalog.DefaultGroup(softwareConfigModule, softwareConfigKey)
	bound := CatalogEntry{ComponentKey: ComponentKeyAppOSAgent}
	bound.ScriptURL = effectiveAppOSAgentInstallerURLFromGroup(map[string]any{
		"apposAgentInstallerUrl": "https://example.com/custom/appos-agent-install.sh",
	}, defaults)
	if got, want := bound.ScriptURL, "https://example.com/custom/appos-agent-install.sh"; got != want {
		t.Fatalf("expected custom installer url %q, got %q", want, got)
	}
}
