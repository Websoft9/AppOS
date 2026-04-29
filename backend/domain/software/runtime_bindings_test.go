package software_test

import (
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingscatalog "github.com/websoft9/appos/backend/domain/config/sysconfig/catalog"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/domain/software"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func TestApplyRuntimeBindings_AppOSAgentUsesDefaultInstallerURL(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	bound := software.ApplyRuntimeBindings(app, software.CatalogEntry{ComponentKey: software.ComponentKeyAppOSAgent})
	if got, want := bound.ScriptURL, "https://artifact.websoft9.com/stable/appos/agent/appos-agent-install.sh"; got != want {
		t.Fatalf("expected default installer url %q, got %q", want, got)
	}
}

func TestApplyRuntimeBindings_AppOSAgentUsesCustomInstallerURL(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	if err := sysconfig.SetGroup(app, "software", "config", map[string]any{
		"apposAgentInstallerUrl": "https://example.com/custom/appos-agent-install.sh",
	}); err != nil {
		t.Fatal(err)
	}

	bound := software.ApplyRuntimeBindings(app, software.CatalogEntry{ComponentKey: software.ComponentKeyAppOSAgent})
	if got, want := bound.ScriptURL, "https://example.com/custom/appos-agent-install.sh"; got != want {
		t.Fatalf("expected custom installer url %q, got %q", want, got)
	}
}

func TestApplyServerExecutionBindings_AppOSAgentInjectsManagedEnv(t *testing.T) {
	prepareRuntimeBindingSecretKey(t)
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	basicEntry, ok := settingscatalog.FindEntry("basic")
	if !ok {
		t.Fatal("expected basic settings entry")
	}
	if _, err := sysconfig.PatchPocketBaseEntry(app, basicEntry, map[string]any{
		"appName": "AppOS",
		"appURL":  "https://console.example.com",
	}); err != nil {
		t.Fatal(err)
	}

	resolved := software.ApplyServerExecutionBindings(app, "srv-123", "", software.ResolvedTemplate{
		ComponentKey: software.ComponentKeyAppOSAgent,
		Install:      software.InstallSpec{},
		Upgrade:      software.UpgradeSpec{},
	})

	configYAML := resolved.Install.Env["APPOS_AGENT_CONFIG_YAML"]
	if configYAML == "" {
		t.Fatal("expected install env to include APPOS_AGENT_CONFIG_YAML")
	}
	if !strings.Contains(configYAML, "server_id: srv-123") {
		t.Fatalf("expected server id in config yaml, got %q", configYAML)
	}
	if !strings.Contains(configYAML, "ingest_base_url: https://console.example.com/api/monitor/ingest") {
		t.Fatalf("expected app url in config yaml, got %q", configYAML)
	}
	unit := resolved.Install.Env["APPOS_AGENT_SYSTEMD_UNIT"]
	if !strings.Contains(unit, "ExecStart=/usr/local/bin/appos-agent --config /etc/appos-agent.yaml") {
		t.Fatalf("expected managed unit content, got %q", unit)
	}
	if resolved.Upgrade.Env["APPOS_AGENT_CONFIG_YAML"] != configYAML {
		t.Fatalf("expected upgrade env to mirror install env, got %q want %q", resolved.Upgrade.Env["APPOS_AGENT_CONFIG_YAML"], configYAML)
	}
}

func TestApplyServerExecutionBindings_AppOSAgentPrefersExplicitBaseURL(t *testing.T) {
	prepareRuntimeBindingSecretKey(t)
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	basicEntry, ok := settingscatalog.FindEntry("basic")
	if !ok {
		t.Fatal("expected basic settings entry")
	}
	if _, err := sysconfig.PatchPocketBaseEntry(app, basicEntry, map[string]any{
		"appName": "AppOS",
		"appURL":  "https://stale.example.com",
	}); err != nil {
		t.Fatal(err)
	}

	resolved := software.ApplyServerExecutionBindings(app, "srv-123", "https://console.example.com:8443/", software.ResolvedTemplate{
		ComponentKey: software.ComponentKeyAppOSAgent,
		Install:      software.InstallSpec{},
		Upgrade:      software.UpgradeSpec{},
	})

	configYAML := resolved.Install.Env["APPOS_AGENT_CONFIG_YAML"]
	if !strings.Contains(configYAML, "ingest_base_url: https://console.example.com:8443/api/monitor/ingest") {
		t.Fatalf("expected explicit app url in config yaml, got %q", configYAML)
	}
}

func prepareRuntimeBindingSecretKey(t *testing.T) {
	t.Helper()
	t.Setenv(secrets.EnvSecretKey, "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err := secrets.LoadKeyFromEnv(); err != nil {
		t.Fatal(err)
	}
	if err := secrets.LoadTemplatesFromDefaultPath(); err != nil {
		t.Fatal(err)
	}
}
