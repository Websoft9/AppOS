package worker

import (
	"strings"
	"testing"

	"github.com/websoft9/appos/backend/domain/software"
)

func TestApplyServerExecutionBindings_AppOSAgentInjectsManagedEnv(t *testing.T) {
	resolved := applyServerExecutionBindingsWithInputs("srv-123", "https://console.example.com", "agent-token", software.ResolvedTemplate{
		ComponentKey: software.ComponentKeyAppOSAgent,
		Install:      software.InstallSpec{},
		Upgrade:      software.UpgradeSpec{},
	})

	configYAML := resolved.Install.Env[apposAgentConfigEnvName]
	if configYAML == "" {
		t.Fatal("expected install env to include APPOS_AGENT_CONFIG_YAML")
	}
	if !strings.Contains(configYAML, "server_id: srv-123") {
		t.Fatalf("expected server id in config yaml, got %q", configYAML)
	}
	if !strings.Contains(configYAML, "ingest_base_url: https://console.example.com/api/monitor/ingest") {
		t.Fatalf("expected app url in config yaml, got %q", configYAML)
	}
	if !strings.Contains(configYAML, "token: agent-token") {
		t.Fatalf("expected token in config yaml, got %q", configYAML)
	}
	unit := resolved.Install.Env[apposAgentSystemdUnitEnvName]
	if !strings.Contains(unit, "ExecStart=/usr/local/bin/appos-agent --config /etc/appos-agent.yaml") {
		t.Fatalf("expected managed unit content, got %q", unit)
	}
	if resolved.Upgrade.Env[apposAgentConfigEnvName] != configYAML {
		t.Fatalf("expected upgrade env to mirror install env, got %q want %q", resolved.Upgrade.Env[apposAgentConfigEnvName], configYAML)
	}
}

func TestApplyServerExecutionBindings_AppOSAgentPrefersExplicitBaseURL(t *testing.T) {
	baseURL := effectiveAppOSBaseURLFromValue("https://stale.example.com", "https://console.example.com:8443/")
	if baseURL != "https://console.example.com:8443" {
		t.Fatalf("expected explicit app url to win, got %q", baseURL)
	}
}