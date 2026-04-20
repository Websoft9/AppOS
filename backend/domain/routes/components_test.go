package routes

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	comp "github.com/websoft9/appos/backend/domain/components"
)

func (te *testEnv) doComponents(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	components := r.Group("/api/components")
	components.Bind(apis.RequireAuth())
	registerComponentsRoutes(components)

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if authenticated {
		req.Header.Set("Authorization", te.token)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestComponentsListFromRegistry(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tmpDir := t.TempDir()
	healthFile := filepath.Join(tmpDir, "health.txt")
	if err := os.WriteFile(healthFile, []byte("ok"), 0644); err != nil {
		t.Fatal(err)
	}
	registryPath := filepath.Join(tmpDir, "components.yaml")
	registry := `version: 1
components:
  - id: appos
    name: AppOS
    enabled: true
    criticality: core
    version_probe:
      type: static
      value: 1.2.3
    availability_probe:
      type: file_exists
      path: ` + healthFile + `
services: []
`
	restore := comp.SetRegistryPathForTesting(registryPath)
	defer restore()
	if err := os.WriteFile(registryPath, []byte(registry), 0644); err != nil {
		t.Fatal(err)
	}

	rec := te.doComponents(t, http.MethodGet, "/api/components", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	items := parseJSONArray(t, rec)
	if len(items) != 1 {
		t.Fatalf("expected 1 component, got %d", len(items))
	}
	if items[0]["version"] != "1.2.3" {
		t.Fatalf("expected version 1.2.3, got %v", items[0]["version"])
	}
	if items[0]["available"] != true {
		t.Fatalf("expected available true, got %v", items[0]["available"])
	}
}

func TestComponentsListRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doComponents(t, http.MethodGet, "/api/components", "", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestComponentServicesLogsFromFile(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tmpDir := t.TempDir()
	logFile := filepath.Join(tmpDir, "appos.log")
	if err := os.WriteFile(logFile, []byte("hello\nworld\n"), 0644); err != nil {
		t.Fatal(err)
	}
	registryPath := filepath.Join(tmpDir, "components.yaml")
	registry := `version: 1
components:
  - id: appos
    name: AppOS
    enabled: true
    criticality: core
    version_probe:
      type: static
      value: unknown
    availability_probe:
      type: static
      success: true
services:
  - name: appos
    component_id: appos
    enabled: true
    log_access:
      type: file
      stdout_path: ` + logFile + `
      stderr_path: ` + logFile + `
`
	restore := comp.SetRegistryPathForTesting(registryPath)
	defer restore()
	if err := os.WriteFile(registryPath, []byte(registry), 0644); err != nil {
		t.Fatal(err)
	}

	rec := te.doComponents(t, http.MethodGet, "/api/components/services/appos/logs", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	payload := parseJSON(t, rec)
	if payload["name"] != "appos" {
		t.Fatalf("expected appos logs, got %v", payload["name"])
	}
	if !strings.Contains(payload["content"].(string), "hello") {
		t.Fatalf("expected log content, got %v", payload["content"])
	}
}

func TestComponentServicesListGracefulWithoutSupervisor(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	tmpDir := t.TempDir()
	registryPath := filepath.Join(tmpDir, "components.yaml")
	registry := `version: 1
components:
  - id: appos
    name: AppOS
    enabled: true
    criticality: core
    version_probe:
      type: static
      value: unknown
    availability_probe:
      type: static
      success: true
services:
  - name: appos
    component_id: appos
    enabled: true
    log_access:
      type: supervisor
      service: appos
`
	restore := comp.SetRegistryPathForTesting(registryPath)
	defer restore()
	if err := os.WriteFile(registryPath, []byte(registry), 0644); err != nil {
		t.Fatal(err)
	}

	rec := te.doComponents(t, http.MethodGet, "/api/components/services", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	items := parseJSONArray(t, rec)
	if len(items) != 1 {
		t.Fatalf("expected 1 service, got %d", len(items))
	}
	if items[0]["state"] != "unknown" {
		t.Fatalf("expected unknown state without supervisor, got %v", items[0]["state"])
	}
}
