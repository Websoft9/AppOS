package tunnel

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/internal/settings"
)

func newTunnelApp(t *testing.T) *tests.TestApp {
	t.Helper()

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
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

func TestDefaultPortRange(t *testing.T) {
	portRange := DefaultPortRange()
	if portRange.Start != DefaultPortRangeStart {
		t.Fatalf("expected default start %d, got %d", DefaultPortRangeStart, portRange.Start)
	}
	if portRange.End != DefaultPortRangeEnd {
		t.Fatalf("expected default end %d, got %d", DefaultPortRangeEnd, portRange.End)
	}
}

func TestNormalizePortRangeRejectsInvalidRange(t *testing.T) {
	portRange := NormalizePortRange(map[string]any{
		"start": 2200,
		"end":   2300,
	})

	if portRange != DefaultPortRange() {
		t.Fatalf("expected invalid range to fall back to defaults, got %#v", portRange)
	}
}

func TestLoadPortRangeNilReturnsDefault(t *testing.T) {
	if got := LoadPortRange(nil); got != DefaultPortRange() {
		t.Fatalf("expected default port range, got %#v", got)
	}
}

func TestLoadPortRangeReadsStoredValue(t *testing.T) {
	app := newTunnelApp(t)
	defer app.Cleanup()

	if err := settings.SetGroup(app, SettingsModule, PortRangeKey, map[string]any{
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
