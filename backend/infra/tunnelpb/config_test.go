package tunnelpb

import (
	"encoding/base64"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	sec "github.com/websoft9/appos/backend/domain/secrets"
	tunnelcore "github.com/websoft9/appos/backend/infra/tunnelcore"
)

func newTunnelApp(t *testing.T) *tests.TestApp {
	t.Helper()

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv(sec.EnvSecretKey, base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef")))
	if err := sec.LoadKeyFromEnv(); err != nil {
		t.Fatalf("load secret key: %v", err)
	}
	if err := sec.LoadTemplatesFromDefaultPath(); err != nil {
		t.Fatalf("load secret templates: %v", err)
	}
	ensureTunnelCustomSettingsCollection(t, app)
	return app
}

func ensureTunnelCustomSettingsCollection(t *testing.T, app *tests.TestApp) {
	t.Helper()

	if _, err := app.FindCollectionByNameOrId("custom_settings"); err == nil {
		return
	}

	col := core.NewBaseCollection("custom_settings")
	col.Fields.Add(&core.TextField{Name: "module", Required: true})
	col.Fields.Add(&core.TextField{Name: "key", Required: true})
	col.Fields.Add(&core.JSONField{Name: "value"})
	col.Indexes = []string{
		"CREATE UNIQUE INDEX idx_custom_settings_module_key ON custom_settings (module, `key`)",
	}

	if err := app.Save(col); err != nil {
		t.Fatalf("create custom_settings collection: %v", err)
	}
}

func TestLoadPortRangeNilReturnsDefault(t *testing.T) {
	if got := LoadPortRange(nil); got != tunnelcore.DefaultPortRange() {
		t.Fatalf("expected default port range, got %#v", got)
	}
}

func TestLoadPortRangeReadsStoredValue(t *testing.T) {
	app := newTunnelApp(t)
	defer app.Cleanup()

	if err := sysconfig.SetGroup(app, SettingsModule, PortRangeKey, map[string]any{
		"start": 41000,
		"end":   41999,
	}); err != nil {
		t.Fatal(err)
	}

	portRange := LoadPortRange(app)
	if portRange.Start != 41000 {
		t.Fatalf("expected start 41000, got %d", portRange.Start)
	}
	if portRange.End != 41999 {
		t.Fatalf("expected end 41999, got %d", portRange.End)
	}
}
