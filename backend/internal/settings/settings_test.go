package settings_test

import (
	"testing"

	"github.com/websoft9/appos/backend/internal/settings"
)

// ─── Int() tests ──────────────────────────────────────────────────────────

func TestInt_Float64(t *testing.T) {
	g := map[string]any{"maxSizeMB": float64(42)}
	if got := settings.Int(g, "maxSizeMB", 0); got != 42 {
		t.Errorf("expected 42, got %d", got)
	}
}

func TestInt_Int(t *testing.T) {
	g := map[string]any{"n": 7}
	if got := settings.Int(g, "n", 0); got != 7 {
		t.Errorf("expected 7, got %d", got)
	}
}

func TestInt_Missing(t *testing.T) {
	g := map[string]any{}
	if got := settings.Int(g, "missing", 99); got != 99 {
		t.Errorf("expected fallback 99, got %d", got)
	}
}

func TestInt_Nil(t *testing.T) {
	g := map[string]any{"n": nil}
	if got := settings.Int(g, "n", 5); got != 5 {
		t.Errorf("expected fallback 5, got %d", got)
	}
}

// ─── String() tests ───────────────────────────────────────────────────────

func TestString_Present(t *testing.T) {
	g := map[string]any{"host": "smtp.example.com"}
	if got := settings.String(g, "host", ""); got != "smtp.example.com" {
		t.Errorf("expected smtp.example.com, got %q", got)
	}
}

func TestString_Missing(t *testing.T) {
	g := map[string]any{}
	if got := settings.String(g, "host", "default"); got != "default" {
		t.Errorf("expected fallback default, got %q", got)
	}
}

func TestString_WrongType(t *testing.T) {
	g := map[string]any{"host": 123}
	if got := settings.String(g, "host", "fb"); got != "fb" {
		t.Errorf("expected fallback fb, got %q", got)
	}
}

// ─── Int() string numeric tests ───────────────────────────────────────────

func TestInt_StringNumeric(t *testing.T) {
	g := map[string]any{"n": "42"}
	if got := settings.Int(g, "n", 0); got != 42 {
		t.Errorf("expected 42 from string \"42\", got %d", got)
	}
}

func TestInt_StringInvalid(t *testing.T) {
	g := map[string]any{"n": "abc"}
	if got := settings.Int(g, "n", 99); got != 99 {
		t.Errorf("expected fallback 99 for non-numeric string, got %d", got)
	}
}

// ─── GetGroup fallback tests (no real DB required) ────────────────────────

// nilApp is a minimal stub that satisfies core.App for compile-time testing.
// Because package settings imports core.App as an interface, we cannot easily
// instantiate a real PocketBase test app here without the full test harness.
// The GetGroup / SetGroup round-trip tests are covered in integration tests;
// below we test only the typed helpers and the exported function signatures.

// Ensure Int and String signatures are stable (compile-time check).
var _ = settings.Int
var _ = settings.String
