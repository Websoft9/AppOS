package bootstrap

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
	"github.com/websoft9/appos/backend/infra/collections"
	_ "github.com/websoft9/appos/backend/infra/migrations"
	"github.com/websoft9/appos/backend/infra/schema"
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

	foundFeedsPoll := false
	foundFeedsRetention := false
	for _, job := range app.Cron().Jobs() {
		if job.Id() == feedsPollCronJobID {
			foundFeedsPoll = true
		}
		if job.Id() == feedsRetentionCronJobID {
			foundFeedsRetention = true
		}
	}

	if !foundFeedsPoll {
		t.Fatalf("expected cron job %q to be registered", feedsPollCronJobID)
	}
	if !foundFeedsRetention {
		t.Fatalf("expected cron job %q to be registered", feedsRetentionCronJobID)
	}
}

func TestRegisterCronHooksRegistersMonitorReachabilityJobs(t *testing.T) {
	app := pocketbase.New()
	registerCronHooks(app, &asynq.Client{})

	foundInstance := false
	foundAIProvider := false
	foundConnector := false
	foundServer := false
	for _, job := range app.Cron().Jobs() {
		switch job.Id() {
		case monitorInstanceReachabilityCronJobID:
			foundInstance = true
		case monitorAIProviderReachabilityCronJobID:
			foundAIProvider = true
		case monitorConnectorReachabilityCronJobID:
			foundConnector = true
		case monitorServerReachabilityCronJobID:
			foundServer = true
		}
	}

	if !foundInstance {
		t.Fatalf("expected cron job %q to be registered", monitorInstanceReachabilityCronJobID)
	}
	if !foundAIProvider {
		t.Fatalf("expected cron job %q to be registered", monitorAIProviderReachabilityCronJobID)
	}
	if !foundConnector {
		t.Fatalf("expected cron job %q to be registered", monitorConnectorReachabilityCronJobID)
	}
	if !foundServer {
		t.Fatalf("expected cron job %q to be registered", monitorServerReachabilityCronJobID)
	}
	foundWorkflowDispatch := false
	for _, job := range app.Cron().Jobs() {
		if job.Id() == workflowDispatchCronJobID {
			foundWorkflowDispatch = true
		}
	}
	if !foundWorkflowDispatch {
		t.Fatalf("expected cron job %q to be registered", workflowDispatchCronJobID)
	}
}

func TestDispatchWorkflowCronRunsCreatesRunForDueWorkflow(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()
	if err := schema.EnsureAllCollections(app); err != nil {
		t.Fatal(err)
	}
	workflowCol, err := app.FindCollectionByNameOrId(collections.Workflows)
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(workflowCol)
	record.Set("name", "due-workflow")
	record.Set("description", "due")
	record.Set("is_enabled", true)
	record.Set("definition_yaml", "name: due-workflow\ndefault_server_id: srv_1\ntriggers:\n  - type: cron\n    schedule: '0 6 * * *'\nnodes:\n  - key: collect\n    type: shell\n    config:\n      command: echo ok\n")
	record.Set("default_server_id", "srv_1")
	record.Set("trigger_types_json", []any{"cron"})
	record.Set("node_count", 1)
	record.Set("has_ai_nodes", false)
	record.Set("created_by", "system")
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	client := asynq.NewClient(asynq.RedisClientOpt{Addr: "127.0.0.1:6379"})
	defer client.Close()
	now := time.Date(2026, time.May, 25, 6, 0, 0, 0, time.UTC)
	err = dispatchWorkflowCronRuns(app, client, now)
	if err != nil {
		if strings.Contains(err.Error(), "connect") || strings.Contains(err.Error(), "dial tcp") {
			// Queueing may fail in tests without Redis. The dispatch preparation still happened.
		} else {
			t.Fatalf("dispatchWorkflowCronRuns: %v", err)
		}
	}
	runs, findErr := app.FindRecordsByFilter(collections.WorkflowRuns, "workflow_definition = {:workflow}", "created", 0, 0, map[string]any{"workflow": record.Id})
	if findErr != nil {
		t.Fatalf("find runs: %v", findErr)
	}
	if len(runs) != 1 {
		t.Fatalf("expected 1 workflow run, got %d", len(runs))
	}
	if got := strings.TrimSpace(runs[0].GetString("execution_owner_id")); got == "" {
		t.Fatal("expected cron-dispatched run to persist execution_owner_id")
	}
}
