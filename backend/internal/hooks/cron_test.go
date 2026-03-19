package hooks

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	comp "github.com/websoft9/appos/backend/internal/components"
)

func TestRunComponentsInventoryProbeSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	healthFile := filepath.Join(tmpDir, "health")
	registryPath := filepath.Join(tmpDir, "components.yaml")

	writeTestFile(t, healthFile, "ok")
	writeTestFile(t, registryPath, `version: 1
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
      path: `+healthFile+`
    update_probe:
      type: file_mtime
      path: `+healthFile+`
services: []
`)

	restore := comp.SetRegistryPathForTesting(registryPath)
	defer restore()

	if err := runComponentsInventoryProbe(); err != nil {
		t.Fatalf("expected probe to succeed, got %v", err)
	}
}

func TestRunComponentsInventoryProbeAggregatesErrors(t *testing.T) {
	tmpDir := t.TempDir()
	registryPath := filepath.Join(tmpDir, "components.yaml")

	writeTestFile(t, registryPath, `version: 1
components:
  - id: broken
    name: Broken Component
    enabled: true
    criticality: optional
    version_probe:
      type: command
      command: []
    availability_probe:
      type: http
      url: ""
services: []
`)

	restore := comp.SetRegistryPathForTesting(registryPath)
	defer restore()

	err := runComponentsInventoryProbe()
	if err == nil {
		t.Fatal("expected probe to fail")
	}
	message := err.Error()
	if !strings.Contains(message, "broken version probe") {
		t.Fatalf("expected aggregated version probe error, got %q", message)
	}
	if !strings.Contains(message, "broken availability probe") {
		t.Fatalf("expected aggregated availability probe error, got %q", message)
	}
}

func writeTestFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}