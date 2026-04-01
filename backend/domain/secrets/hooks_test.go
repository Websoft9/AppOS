package secrets

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
)

func newSecretsApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	ensureCustomSettingsCollection(t, app)
	ensureSecretsCollection(t, app)
	return app
}

func ensureCustomSettingsCollection(t *testing.T, app *tests.TestApp) {
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

func ensureSecretsCollection(t *testing.T, app *tests.TestApp) {
	t.Helper()

	if _, err := app.FindCollectionByNameOrId("secrets"); err == nil {
		return
	}

	col := core.NewBaseCollection("secrets")
	col.Fields.Add(&core.TextField{Name: "access_mode"})

	if err := app.Save(col); err != nil {
		t.Fatalf("create secrets collection: %v", err)
	}
}

func TestApplyDefaultAccessModeUsesPolicyWhenEmpty(t *testing.T) {
	app := newSecretsApp(t)
	defer app.Cleanup()

	if err := sysconfig.SetGroup(app, "secrets", "policy", map[string]any{
		"revealDisabled":        false,
		"defaultAccessMode":     "reveal_once",
		"clipboardClearSeconds": 0,
	}); err != nil {
		t.Fatal(err)
	}

	col, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)

	applyDefaultAccessMode(app, rec)

	if got := rec.GetString("access_mode"); got != "reveal_once" {
		t.Fatalf("expected reveal_once, got %q", got)
	}
}

func TestApplyDefaultAccessModeKeepsExplicitValue(t *testing.T) {
	app := newSecretsApp(t)
	defer app.Cleanup()

	if err := sysconfig.SetGroup(app, "secrets", "policy", map[string]any{
		"revealDisabled":        false,
		"defaultAccessMode":     "reveal_once",
		"clipboardClearSeconds": 0,
	}); err != nil {
		t.Fatal(err)
	}

	col, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("access_mode", "reveal_allowed")

	applyDefaultAccessMode(app, rec)

	if got := rec.GetString("access_mode"); got != "reveal_allowed" {
		t.Fatalf("expected reveal_allowed, got %q", got)
	}
}

func TestApplyDefaultAccessModeFallsBackToUseOnlyForInvalidPolicy(t *testing.T) {
	app := newSecretsApp(t)
	defer app.Cleanup()

	if err := sysconfig.SetGroup(app, "secrets", "policy", map[string]any{
		"revealDisabled":        false,
		"defaultAccessMode":     "bad-value",
		"clipboardClearSeconds": 0,
	}); err != nil {
		t.Fatal(err)
	}

	col, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)

	applyDefaultAccessMode(app, rec)

	if got := rec.GetString("access_mode"); got != "use_only" {
		t.Fatalf("expected use_only fallback, got %q", got)
	}
}
