package software_test

import (
	"testing"

	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
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
