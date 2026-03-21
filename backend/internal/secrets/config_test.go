package secrets

import (
	"encoding/base64"
	"testing"

	"github.com/websoft9/appos/backend/internal/settings"
)

func TestDefaultPolicy(t *testing.T) {
	policy := DefaultPolicy()

	if policy.RevealDisabled {
		t.Fatal("expected revealDisabled to default to false")
	}
	if policy.DefaultAccessMode != AccessModeUseOnly {
		t.Fatalf("expected default access mode %q, got %q", AccessModeUseOnly, policy.DefaultAccessMode)
	}
	if policy.ClipboardClearSeconds != 0 {
		t.Fatalf("expected clipboard clear seconds 0, got %d", policy.ClipboardClearSeconds)
	}
}

func TestNormalizePolicyAppliesSafeDefaults(t *testing.T) {
	policy := NormalizePolicy(map[string]any{
		"revealDisabled":        true,
		"defaultAccessMode":     "bad-value",
		"clipboardClearSeconds": -10,
	})

	if !policy.RevealDisabled {
		t.Fatal("expected revealDisabled to be preserved")
	}
	if policy.DefaultAccessMode != AccessModeUseOnly {
		t.Fatalf("expected invalid mode to normalize to %q, got %q", AccessModeUseOnly, policy.DefaultAccessMode)
	}
	if policy.ClipboardClearSeconds != 0 {
		t.Fatalf("expected negative clipboard clear seconds to normalize to 0, got %d", policy.ClipboardClearSeconds)
	}
}

func TestNormalizePolicyAcceptsStringInteger(t *testing.T) {
	policy := NormalizePolicy(map[string]any{
		"defaultAccessMode":     AccessModeRevealAllowed,
		"clipboardClearSeconds": "15",
	})

	if policy.DefaultAccessMode != AccessModeRevealAllowed {
		t.Fatalf("expected access mode %q, got %q", AccessModeRevealAllowed, policy.DefaultAccessMode)
	}
	if policy.ClipboardClearSeconds != 15 {
		t.Fatalf("expected clipboard clear seconds 15, got %d", policy.ClipboardClearSeconds)
	}
}

func TestValidatePolicyNormalizesValidInput(t *testing.T) {
	raw := map[string]any{
		"revealDisabled":        true,
		"defaultAccessMode":     AccessModeRevealOnce,
		"clipboardClearSeconds": "20",
	}

	if errs := ValidatePolicy(raw); errs != nil {
		t.Fatalf("expected no validation errors, got %#v", errs)
	}

	if raw["defaultAccessMode"] != AccessModeRevealOnce {
		t.Fatalf("expected normalized defaultAccessMode %q, got %#v", AccessModeRevealOnce, raw["defaultAccessMode"])
	}
	if raw["clipboardClearSeconds"] != 20 {
		t.Fatalf("expected normalized clipboardClearSeconds 20, got %#v", raw["clipboardClearSeconds"])
	}
}

func TestValidatePolicyRejectsInvalidInput(t *testing.T) {
	raw := map[string]any{
		"revealDisabled":        "yes",
		"defaultAccessMode":     "invalid",
		"clipboardClearSeconds": -1,
	}

	errs := ValidatePolicy(raw)
	if errs == nil {
		t.Fatal("expected validation errors")
	}
	if errs["revealDisabled"] == "" {
		t.Fatal("expected revealDisabled validation error")
	}
	if errs["defaultAccessMode"] == "" {
		t.Fatal("expected defaultAccessMode validation error")
	}
	if errs["clipboardClearSeconds"] == "" {
		t.Fatal("expected clipboardClearSeconds validation error")
	}
}

func TestPolicyToMap(t *testing.T) {
	policy := Policy{
		RevealDisabled:        true,
		DefaultAccessMode:     AccessModeRevealAllowed,
		ClipboardClearSeconds: 30,
	}

	raw := policy.ToMap()
	if raw["revealDisabled"] != true {
		t.Fatalf("expected revealDisabled true, got %#v", raw["revealDisabled"])
	}
	if raw["defaultAccessMode"] != AccessModeRevealAllowed {
		t.Fatalf("expected defaultAccessMode %q, got %#v", AccessModeRevealAllowed, raw["defaultAccessMode"])
	}
	if raw["clipboardClearSeconds"] != 30 {
		t.Fatalf("expected clipboardClearSeconds 30, got %#v", raw["clipboardClearSeconds"])
	}
}

func TestGetPolicyNilReturnsDefault(t *testing.T) {
	policy := GetPolicy(nil)
	if policy != DefaultPolicy() {
		t.Fatalf("expected default policy, got %#v", policy)
	}
}

func TestGetPolicyReadsStoredValue(t *testing.T) {
	app := newSecretsApp(t)
	defer app.Cleanup()

	if err := settings.SetGroup(app, SettingsModule, PolicySettingsKey, map[string]any{
		"revealDisabled":        true,
		"defaultAccessMode":     AccessModeRevealAllowed,
		"clipboardClearSeconds": 25,
	}); err != nil {
		t.Fatal(err)
	}

	policy := GetPolicy(app)
	if !policy.RevealDisabled {
		t.Fatal("expected revealDisabled true")
	}
	if policy.DefaultAccessMode != AccessModeRevealAllowed {
		t.Fatalf("expected defaultAccessMode %q, got %q", AccessModeRevealAllowed, policy.DefaultAccessMode)
	}
	if policy.ClipboardClearSeconds != 25 {
		t.Fatalf("expected clipboardClearSeconds 25, got %d", policy.ClipboardClearSeconds)
	}
}

func TestLoadKeyFromEnv_Missing(t *testing.T) {
	resetKeyForTest()
	t.Setenv(EnvSecretKey, "")
	if err := LoadKeyFromEnv(); err == nil {
		t.Fatal("expected error for missing key")
	}
}

func TestLoadKeyFromEnv_InvalidBase64(t *testing.T) {
	resetKeyForTest()
	t.Setenv(EnvSecretKey, "not-valid-base64!!!")
	if err := LoadKeyFromEnv(); err == nil {
		t.Fatal("expected error for invalid base64")
	}
}

func TestLoadKeyFromEnv_WrongLength(t *testing.T) {
	resetKeyForTest()
	t.Setenv(EnvSecretKey, base64.StdEncoding.EncodeToString([]byte("tooshort")))
	if err := LoadKeyFromEnv(); err == nil {
		t.Fatal("expected error for wrong key length")
	}
}

func TestLoadKeyFromEnv_Valid(t *testing.T) {
	resetKeyForTest()
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	t.Setenv(EnvSecretKey, key)
	if err := LoadKeyFromEnv(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	k, err := currentKey()
	if err != nil {
		t.Fatal(err)
	}
	if len(k) != 32 {
		t.Fatalf("expected 32-byte key, got %d", len(k))
	}
}

func TestCurrentKey_Uninitialized(t *testing.T) {
	resetKeyForTest()
	_, err := currentKey()
	if err == nil {
		t.Fatal("expected error for uninitialized key")
	}
}
