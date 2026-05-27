package bootstrap

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase"
	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
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

	restore := swcatalog.SetLocalRegistryPathForTesting(registryPath)
	defer restore()

	if err := runComponentsInventoryProbe(nil); err != nil {
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

	restore := swcatalog.SetLocalRegistryPathForTesting(registryPath)
	defer restore()

	err := runComponentsInventoryProbe(nil)
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
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestShouldRunMonitorInterval(t *testing.T) {
	now := time.Date(2026, time.May, 25, 10, 15, 0, 0, time.UTC)
	if !shouldRunMonitorInterval(now, 1) {
		t.Fatal("expected 1-minute interval to run")
	}
	if !shouldRunMonitorInterval(now, 5) {
		t.Fatal("expected 5-minute interval to run at minute 15")
	}
	if shouldRunMonitorInterval(now, 7) {
		t.Fatal("expected 7-minute interval not to run at minute 15")
	}
}

func TestRegisterCronHooksRegistersFeedsPollJob(t *testing.T) {
	app := pocketbase.New()
	registerCronHooks(app, nil)

	for _, job := range app.Cron().Jobs() {
		if job.Id() == feedsPollCronJobID {
			return
		}
	}

	t.Fatalf("expected cron job %q to be registered", feedsPollCronJobID)
}
