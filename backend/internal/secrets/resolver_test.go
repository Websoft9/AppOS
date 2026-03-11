package secrets

import (
	"errors"
	"testing"
)

// ─── IsSecretRef / ExtractSecretID ───────────────────────────────────────────

func TestIsSecretRef(t *testing.T) {
	cases := []struct {
		input string
		want  bool
	}{
		{"secretRef:abc123", true},
		{"secretRef:", true}, // has prefix; ExtractSecretID handles empty-ID rejection
		{"abc123", false},
		{"", false},
		{"secretref:abc", false}, // case-sensitive
		{"secretRef:some-uuid-here", true},
	}
	for _, tc := range cases {
		if got := IsSecretRef(tc.input); got != tc.want {
			t.Errorf("IsSecretRef(%q) = %v, want %v", tc.input, got, tc.want)
		}
	}
}

func TestExtractSecretID(t *testing.T) {
	id, ok := ExtractSecretID("secretRef:my-uuid")
	if !ok || id != "my-uuid" {
		t.Errorf("expected (my-uuid, true), got (%q, %v)", id, ok)
	}

	_, ok = ExtractSecretID("notARef")
	if ok {
		t.Errorf("expected false for non-secretRef string")
	}

	_, ok = ExtractSecretID("secretRef:")
	if ok {
		t.Errorf("expected false for secretRef with empty ID")
	}
}

// ─── FirstStringFromPayload ───────────────────────────────────────────────────

func TestFirstStringFromPayload(t *testing.T) {
	payload := map[string]any{
		"password":    "hunter2",
		"private_key": "",
		"value":       "fallback",
	}

	if got := FirstStringFromPayload(payload, "password", "value"); got != "hunter2" {
		t.Errorf("expected hunter2, got %q", got)
	}
	// empty string is skipped
	if got := FirstStringFromPayload(payload, "private_key", "value"); got != "fallback" {
		t.Errorf("expected fallback, got %q", got)
	}
	if got := FirstStringFromPayload(payload, "missing"); got != "" {
		t.Errorf("expected empty string, got %q", got)
	}
}

// ─── ResolveError ────────────────────────────────────────────────────────────

func TestResolveError_Error(t *testing.T) {
	cause := errors.New("db timeout")
	e := &ResolveError{SecretID: "abc", Reason: "not found", Cause: cause}
	if e.Error() != "secret abc: not found: db timeout" {
		t.Errorf("unexpected error string: %s", e.Error())
	}

	e2 := &ResolveError{SecretID: "abc", Reason: "revoked"}
	if e2.Error() != "secret abc: revoked" {
		t.Errorf("unexpected error string: %s", e2.Error())
	}

	if e.Unwrap() != cause {
		t.Error("Unwrap should return the cause error")
	}
	if e2.Unwrap() != nil {
		t.Error("Unwrap should return nil when no cause")
	}
}
