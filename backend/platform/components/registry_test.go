package components

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// ─── Registry.Validate() ──────────────────────────────────────────────────────

func TestValidate_Valid(t *testing.T) {
	reg := &Registry{
		Version: 1,
		Components: []Component{
			{ID: "appos", Name: "AppOS", Enabled: true},
		},
		Services: []Service{
			{Name: "appos", Enabled: true},
		},
	}
	if err := reg.Validate(); err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
}

func TestValidate_VersionZero(t *testing.T) {
	reg := &Registry{Version: 0}
	if err := reg.Validate(); err == nil {
		t.Fatal("expected error for version 0")
	}
}

func TestValidate_MissingComponentID(t *testing.T) {
	reg := &Registry{
		Version:    1,
		Components: []Component{{ID: "", Name: "AppOS"}},
	}
	if err := reg.Validate(); err == nil {
		t.Fatal("expected error for missing component id")
	}
}

func TestValidate_MissingComponentName(t *testing.T) {
	reg := &Registry{
		Version:    1,
		Components: []Component{{ID: "appos", Name: ""}},
	}
	if err := reg.Validate(); err == nil {
		t.Fatal("expected error for missing component name")
	}
}

func TestValidate_DuplicateComponentID(t *testing.T) {
	reg := &Registry{
		Version: 1,
		Components: []Component{
			{ID: "appos", Name: "AppOS"},
			{ID: "appos", Name: "AppOS Duplicate"},
		},
	}
	if err := reg.Validate(); err == nil {
		t.Fatal("expected error for duplicate component id")
	}
}

func TestValidate_MissingServiceName(t *testing.T) {
	reg := &Registry{
		Version:  1,
		Services: []Service{{Name: ""}},
	}
	if err := reg.Validate(); err == nil {
		t.Fatal("expected error for missing service name")
	}
}

func TestValidate_DuplicateServiceName(t *testing.T) {
	reg := &Registry{
		Version: 1,
		Services: []Service{
			{Name: "appos"},
			{Name: "appos"},
		},
	}
	if err := reg.Validate(); err == nil {
		t.Fatal("expected error for duplicate service name")
	}
}

// ─── DetectVersion ────────────────────────────────────────────────────────────

func TestDetectVersion_Static(t *testing.T) {
	v, err := DetectVersion(Probe{Type: "static", Value: "1.2.3"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if v != "1.2.3" {
		t.Fatalf("expected 1.2.3, got %q", v)
	}
}

func TestDetectVersion_StaticEmpty(t *testing.T) {
	v, err := DetectVersion(Probe{Type: "static", Value: ""})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if v != "unknown" {
		t.Fatalf("expected unknown for empty static value, got %q", v)
	}
}

func TestDetectVersion_File(t *testing.T) {
	tmp := t.TempDir()
	f := filepath.Join(tmp, "version.txt")
	if err := os.WriteFile(f, []byte("2.0.0\nignored line\n"), 0644); err != nil {
		t.Fatal(err)
	}
	v, err := DetectVersion(Probe{Type: "file", Path: f})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if v != "2.0.0" {
		t.Fatalf("expected 2.0.0 (first line), got %q", v)
	}
}

func TestDetectVersion_FileMissing(t *testing.T) {
	v, _ := DetectVersion(Probe{Type: "file", Path: "/nonexistent/version.txt"})
	if v != "unknown" {
		t.Fatalf("expected unknown for missing file, got %q", v)
	}
}

func TestDetectVersion_FileEmptyPath(t *testing.T) {
	_, err := DetectVersion(Probe{Type: "file", Path: ""})
	if err == nil {
		t.Fatal("expected error for empty file path")
	}
}

func TestDetectVersion_UnknownType(t *testing.T) {
	_, err := DetectVersion(Probe{Type: "unknown_probe_type"})
	if err == nil {
		t.Fatal("expected error for unknown probe type")
	}
}

// ─── CheckAvailability ────────────────────────────────────────────────────────

func TestCheckAvailability_StaticTrue(t *testing.T) {
	ok, err := CheckAvailability(Probe{Type: "static", Success: true})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("expected true for static probe with Success=true")
	}
}

func TestCheckAvailability_StaticFalse(t *testing.T) {
	ok, err := CheckAvailability(Probe{Type: "static", Success: false})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Fatal("expected false for static probe with Success=false")
	}
}

func TestCheckAvailability_FileExists(t *testing.T) {
	tmp := t.TempDir()
	f := filepath.Join(tmp, "health")
	if err := os.WriteFile(f, []byte("ok"), 0644); err != nil {
		t.Fatal(err)
	}
	ok, err := CheckAvailability(Probe{Type: "file_exists", Path: f})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("expected true when file exists")
	}
}

func TestCheckAvailability_FileExistsMissing(t *testing.T) {
	ok, err := CheckAvailability(Probe{Type: "file_exists", Path: "/tmp/appos-test-nonexistent-path"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Fatal("expected false for non-existent file")
	}
}

func TestCheckAvailability_FileExistsEmptyPath(t *testing.T) {
	_, err := CheckAvailability(Probe{Type: "file_exists", Path: ""})
	if err == nil {
		t.Fatal("expected error for empty path")
	}
}

func TestCheckAvailability_HTTP200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	ok, err := CheckAvailability(Probe{Type: "http", URL: srv.URL, ExpectStatus: 200})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("expected available for 200 response")
	}
}

func TestCheckAvailability_HTTPWrongStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	ok, err := CheckAvailability(Probe{Type: "http", URL: srv.URL, ExpectStatus: 200})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Fatal("expected unavailable for 503 response")
	}
}

func TestCheckAvailability_HTTPWithMatchingOutput(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer srv.Close()
	ok, err := CheckAvailability(Probe{
		Type:         "http",
		URL:          srv.URL,
		ExpectStatus: 200,
		ExpectOutput: `"status":"ok"`,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("expected available when body contains expected output")
	}
}

func TestCheckAvailability_HTTPWithMismatchedOutput(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"degraded"}`))
	}))
	defer srv.Close()
	ok, err := CheckAvailability(Probe{
		Type:         "http",
		URL:          srv.URL,
		ExpectStatus: 200,
		ExpectOutput: `"status":"ok"`,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Fatal("expected unavailable when body does not contain expected output")
	}
}

func TestCheckAvailability_HTTPEmptyURL(t *testing.T) {
	_, err := CheckAvailability(Probe{Type: "http", URL: ""})
	if err == nil {
		t.Fatal("expected error for empty URL")
	}
}

func TestCheckAvailability_UnknownType(t *testing.T) {
	_, err := CheckAvailability(Probe{Type: "unknown_probe_type"})
	if err == nil {
		t.Fatal("expected error for unknown probe type")
	}
}

// ─── LoadRegistry ─────────────────────────────────────────────────────────────

func TestLoadRegistry_ValidEmbedded(t *testing.T) {
	reg, err := LoadRegistry()
	if err != nil {
		t.Fatalf("embedded registry should load without error: %v", err)
	}
	if reg.Version <= 0 {
		t.Fatalf("expected version >= 1, got %d", reg.Version)
	}
	if len(reg.Components) == 0 {
		t.Fatal("expected at least one component in embedded registry")
	}
}

func TestLoadRegistry_InvalidYAML(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "bad.yaml")
	if err := os.WriteFile(path, []byte(":::not valid yaml:::"), 0644); err != nil {
		t.Fatal(err)
	}
	restore := SetRegistryPathForTesting(path)
	defer restore()
	if _, err := LoadRegistry(); err == nil {
		t.Fatal("expected error for invalid YAML")
	}
}

func TestLoadRegistry_MissingVersion(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "no-version.yaml")
	if err := os.WriteFile(path, []byte("components: []\nservices: []\n"), 0644); err != nil {
		t.Fatal(err)
	}
	restore := SetRegistryPathForTesting(path)
	defer restore()
	if _, err := LoadRegistry(); err == nil {
		t.Fatal("expected error when version is missing/zero")
	}
}

func TestLoadRegistry_DuplicateComponentID(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "dup.yaml")
	content := `version: 1
components:
  - id: foo
    name: Foo
    enabled: true
    criticality: core
    version_probe:
      type: static
      value: "1"
    availability_probe:
      type: static
      success: true
  - id: foo
    name: FooDuplicate
    enabled: true
    criticality: core
    version_probe:
      type: static
      value: "2"
    availability_probe:
      type: static
      success: true
services: []
`
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	restore := SetRegistryPathForTesting(path)
	defer restore()
	if _, err := LoadRegistry(); err == nil {
		t.Fatal("expected error for duplicate component ID")
	}
}

func TestLoadRegistry_FileNotFound(t *testing.T) {
	restore := SetRegistryPathForTesting("/nonexistent/path/components.yaml")
	defer restore()
	if _, err := LoadRegistry(); err == nil {
		t.Fatal("expected error for non-existent registry file")
	}
}

// ─── EnabledComponents / EnabledServices / FindService ───────────────────────

func TestEnabledComponents(t *testing.T) {
	reg := &Registry{
		Version: 1,
		Components: []Component{
			{ID: "a", Name: "A", Enabled: true},
			{ID: "b", Name: "B", Enabled: false},
			{ID: "c", Name: "C", Enabled: true},
		},
	}
	enabled := reg.EnabledComponents()
	if len(enabled) != 2 {
		t.Fatalf("expected 2 enabled components, got %d", len(enabled))
	}
	if enabled[0].ID != "a" || enabled[1].ID != "c" {
		t.Fatalf("unexpected enabled component order: %v", enabled)
	}
}

func TestEnabledServices(t *testing.T) {
	reg := &Registry{
		Version: 1,
		Services: []Service{
			{Name: "svc1", Enabled: true},
			{Name: "svc2", Enabled: false},
		},
	}
	enabled := reg.EnabledServices()
	if len(enabled) != 1 {
		t.Fatalf("expected 1 enabled service, got %d", len(enabled))
	}
	if enabled[0].Name != "svc1" {
		t.Fatalf("expected svc1, got %q", enabled[0].Name)
	}
}

func TestFindService_Found(t *testing.T) {
	reg := &Registry{
		Version: 1,
		Services: []Service{
			{Name: "appos", Enabled: true},
		},
	}
	svc, ok := reg.FindService("appos")
	if !ok {
		t.Fatal("expected to find appos service")
	}
	if svc.Name != "appos" {
		t.Fatalf("expected appos, got %q", svc.Name)
	}
}

func TestFindService_DisabledNotFound(t *testing.T) {
	reg := &Registry{
		Version: 1,
		Services: []Service{
			{Name: "nginx", Enabled: false},
		},
	}
	if _, ok := reg.FindService("nginx"); ok {
		t.Fatal("disabled service should not be returned by FindService")
	}
}

func TestFindService_NonExistent(t *testing.T) {
	reg := &Registry{Version: 1}
	if _, ok := reg.FindService("nonexistent"); ok {
		t.Fatal("expected non-existent service not to be found")
	}
}
