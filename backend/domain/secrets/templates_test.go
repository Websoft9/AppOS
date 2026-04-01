package secrets

import (
	"encoding/json"
	"testing"
)

func TestLoadTemplatesFromBytes_Valid(t *testing.T) {
	data := `[{"id":"t1","label":"Test","fields":[{"key":"k","label":"K","type":"text"}]}]`
	if err := loadTemplatesFromBytes([]byte(data)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	ts := Templates()
	if len(ts) != 1 {
		t.Fatalf("expected 1 template, got %d", len(ts))
	}
	if ts[0].ID != "t1" {
		t.Errorf("expected id=t1, got %s", ts[0].ID)
	}
}

func TestLoadTemplatesFromBytes_Empty(t *testing.T) {
	if err := loadTemplatesFromBytes([]byte("[]")); err == nil {
		t.Fatal("expected error for empty templates list")
	}
}

func TestLoadTemplatesFromBytes_InvalidJSON(t *testing.T) {
	if err := loadTemplatesFromBytes([]byte("not json")); err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestLoadTemplatesFromBytes_DuplicateID(t *testing.T) {
	data := `[{"id":"dup","label":"A","fields":[]},{"id":"dup","label":"B","fields":[]}]`
	if err := loadTemplatesFromBytes([]byte(data)); err == nil {
		t.Fatal("expected error for duplicate template id")
	}
}

func TestLoadTemplatesFromBytes_EmptyID(t *testing.T) {
	data := `[{"id":"","label":"X","fields":[]}]`
	if err := loadTemplatesFromBytes([]byte(data)); err == nil {
		t.Fatal("expected error for empty template id")
	}
}

func TestFindTemplate_Found(t *testing.T) {
	data := `[{"id":"a","label":"A","fields":[]},{"id":"b","label":"B","fields":[]}]`
	if err := loadTemplatesFromBytes([]byte(data)); err != nil {
		t.Fatal(err)
	}

	tpl, ok := FindTemplate("b")
	if !ok {
		t.Fatal("expected to find template b")
	}
	if tpl.Label != "B" {
		t.Errorf("expected label=B, got %s", tpl.Label)
	}
}

func TestFindTemplate_NotFound(t *testing.T) {
	data := `[{"id":"x","label":"X","fields":[]}]`
	if err := loadTemplatesFromBytes([]byte(data)); err != nil {
		t.Fatal(err)
	}

	_, ok := FindTemplate("nonexistent")
	if ok {
		t.Fatal("expected not found")
	}
}

func TestBuildPayloadMeta_MasksSensitiveFields(t *testing.T) {
	tpl := Template{
		ID:    "test",
		Label: "Test",
		Fields: []TemplateField{
			{Key: "username", Label: "User", Type: "text", Sensitive: false},
			{Key: "password", Label: "Pass", Type: "password", Sensitive: true},
		},
	}
	payload := map[string]any{
		"username": "admin",
		"password": "supersecret",
	}

	meta := BuildPayloadMeta(payload, tpl)

	// Non-sensitive field stored as-is
	if meta["username"] != "admin" {
		t.Errorf("expected username=admin, got %v", meta["username"])
	}
	// Sensitive field stored as masked hint
	hint, ok := meta["password_hint"]
	if !ok {
		t.Fatal("expected password_hint in meta")
	}
	if hint != "su***" {
		t.Errorf("expected password_hint=su***, got %v", hint)
	}
	// Raw password key should NOT be in meta
	if _, exists := meta["password"]; exists {
		t.Error("raw password key should not exist in meta")
	}
}

func TestMaskValue(t *testing.T) {
	tests := []struct {
		input    any
		expected string
	}{
		{"abcdef", "ab***"},
		{"ab", "***"},
		{"a", "***"},
		{"", "***"},
		{12345, "12***"},
	}
	for _, tc := range tests {
		got := maskValue(tc.input)
		if got != tc.expected {
			t.Errorf("maskValue(%v) = %q, want %q", tc.input, got, tc.expected)
		}
	}
}

func TestTemplatesReturnsCopy(t *testing.T) {
	data := `[{"id":"x","label":"X","fields":[]}]`
	if err := loadTemplatesFromBytes([]byte(data)); err != nil {
		t.Fatal(err)
	}

	ts1 := Templates()
	ts1[0].ID = "modified"

	ts2 := Templates()
	if ts2[0].ID == "modified" {
		t.Error("Templates() should return a copy, not a reference to internal state")
	}
}

func TestEmbeddedTemplatesValid(t *testing.T) {
	if len(embeddedTemplatesJSON) == 0 {
		t.Fatal("embedded templates.json is empty")
	}
	var list []Template
	if err := json.Unmarshal(embeddedTemplatesJSON, &list); err != nil {
		t.Fatalf("embedded templates.json parse error: %v", err)
	}
	if len(list) == 0 {
		t.Fatal("embedded templates list is empty")
	}
	seen := map[string]bool{}
	for _, tpl := range list {
		if tpl.ID == "" {
			t.Error("template with empty id")
		}
		if seen[tpl.ID] {
			t.Errorf("duplicate template id: %s", tpl.ID)
		}
		seen[tpl.ID] = true
	}
}
