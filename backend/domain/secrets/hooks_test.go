package secrets

import (
	"testing"
	"time"

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
	col.Fields.Add(&core.TextField{Name: "name"})
	col.Fields.Add(&core.TextField{Name: "access_mode"})
	col.Fields.Add(&core.TextField{Name: "expires_at"})
	col.Fields.Add(&core.TextField{Name: "scope"})
	col.Fields.Add(&core.TextField{Name: "created_by"})
	col.Fields.Add(&core.TextField{Name: "created_source"})
	col.Fields.Add(&core.TextField{Name: "template_id"})
	col.Fields.Add(&core.TextField{Name: "status"})
	col.Fields.Add(&core.TextField{Name: "value"})
	col.Fields.Add(&core.TextField{Name: "payload_encrypted"})
	col.Fields.Add(&core.JSONField{Name: "payload_meta"})
	col.Fields.Add(&core.NumberField{Name: "version"})
	col.Fields.Add(&core.TextField{Name: "type"})

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

func TestApplyExpiryPolicySetsExpiresAt(t *testing.T) {
	app := newSecretsApp(t)
	defer app.Cleanup()

	if err := sysconfig.SetGroup(app, "secrets", "policy", map[string]any{
		"maxAgeDays": 30,
	}); err != nil {
		t.Fatal(err)
	}

	col, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)

	before := time.Now().UTC().Truncate(time.Second)
	applyExpiryPolicy(app, rec)
	after := time.Now().UTC().Add(time.Second).Truncate(time.Second)

	raw := rec.GetString("expires_at")
	if raw == "" {
		t.Fatal("expected expires_at to be set")
	}
	exp, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		t.Fatalf("invalid expires_at format: %v", err)
	}
	expMin := before.Add(30 * 24 * time.Hour)
	expMax := after.Add(30 * 24 * time.Hour)
	if exp.Before(expMin) || exp.After(expMax) {
		t.Fatalf("expires_at %v out of expected range [%v, %v]", exp, expMin, expMax)
	}
}

func TestApplyExpiryPolicyZeroMaxAgeLeavesFieldEmpty(t *testing.T) {
	app := newSecretsApp(t)
	defer app.Cleanup()

	if err := sysconfig.SetGroup(app, "secrets", "policy", map[string]any{
		"maxAgeDays": 0,
	}); err != nil {
		t.Fatal(err)
	}

	col, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	applyExpiryPolicy(app, rec)

	if got := rec.GetString("expires_at"); got != "" {
		t.Fatalf("expected expires_at empty when maxAgeDays=0, got %q", got)
	}
}

func TestApplyExpiryPolicyNilAppAndRecord(t *testing.T) {
	// Must not panic
	applyExpiryPolicy(nil, nil)
}
