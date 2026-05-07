package worker

import (
	"os"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

var (
	workerTestBaselineOnce sync.Once
	workerTestBaselineDir  string
	workerTestBaselineErr  error
	workerTestSharedOnce   sync.Once
	workerTestSharedApp    *tests.TestApp
	workerTestSharedErr    error
)

func TestMain(m *testing.M) {
	code := m.Run()
	if workerTestSharedApp != nil {
		workerTestSharedApp.Cleanup()
	}
	if workerTestBaselineDir != "" {
		_ = os.RemoveAll(workerTestBaselineDir)
	}
	os.Exit(code)
}

func workerTestBaselineDataDir() (string, error) {
	workerTestBaselineOnce.Do(func() {
		app, err := tests.NewTestApp()
		if err != nil {
			workerTestBaselineErr = err
			return
		}

		workerTestBaselineDir = app.DataDir()
		workerTestBaselineErr = app.ResetBootstrapState()
	})

	return workerTestBaselineDir, workerTestBaselineErr
}

func newWorkerTestApp(t *testing.T) *tests.TestApp {
	t.Helper()

	workerTestSharedOnce.Do(func() {
		baselineDir, err := workerTestBaselineDataDir()
		if err != nil {
			workerTestSharedErr = err
			return
		}

		workerTestSharedApp, err = tests.NewTestApp(baselineDir)
		if err != nil {
			workerTestSharedErr = err
		}
	})
	if workerTestSharedErr != nil {
		t.Fatal(workerTestSharedErr)
	}

	resetWorkerTestState(t, workerTestSharedApp)
	return workerTestSharedApp
}

func resetWorkerTestState(t *testing.T, app *tests.TestApp) {
	t.Helper()

	for _, collection := range []string{
		"monitor_latest_status",
		"software_inventory_snapshots",
		"audit_logs",
		"pipeline_node_runs",
		"app_exposures",
		"app_operations",
		"app_releases",
		"pipeline_runs",
		"software_operations",
		"deployments",
		"instances",
		"secrets",
		"app_instances",
	} {
		if _, err := app.FindCollectionByNameOrId(collection); err != nil {
			continue
		}
		records, err := app.FindAllRecords(collection)
		if err != nil {
			t.Fatalf("reset %s: %v", collection, err)
		}
		for _, record := range records {
			if err := app.Delete(record); err != nil {
				t.Fatalf("delete %s/%s: %v", collection, record.Id, err)
			}
		}
	}
}
