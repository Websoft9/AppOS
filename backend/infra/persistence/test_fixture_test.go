package persistence

import (
	"os"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

var (
	persistenceTestBaselineOnce sync.Once
	persistenceTestBaselineDir  string
	persistenceTestBaselineErr  error
	persistenceTestSharedOnce   sync.Once
	persistenceTestSharedApp    *tests.TestApp
	persistenceTestSharedErr    error
)

func TestMain(m *testing.M) {
	code := m.Run()
	if persistenceTestSharedApp != nil {
		persistenceTestSharedApp.Cleanup()
	}
	if persistenceTestBaselineDir != "" {
		_ = os.RemoveAll(persistenceTestBaselineDir)
	}
	os.Exit(code)
}

func persistenceTestBaselineDataDir() (string, error) {
	persistenceTestBaselineOnce.Do(func() {
		app, err := tests.NewTestApp()
		if err != nil {
			persistenceTestBaselineErr = err
			return
		}

		persistenceTestBaselineDir = app.DataDir()
		persistenceTestBaselineErr = app.ResetBootstrapState()
	})

	return persistenceTestBaselineDir, persistenceTestBaselineErr
}

func newPersistenceTestApp(t *testing.T) *tests.TestApp {
	t.Helper()

	persistenceTestSharedOnce.Do(func() {
		baselineDir, err := persistenceTestBaselineDataDir()
		if err != nil {
			persistenceTestSharedErr = err
			return
		}

		persistenceTestSharedApp, err = tests.NewTestApp(baselineDir)
		if err != nil {
			persistenceTestSharedErr = err
		}
	})
	if persistenceTestSharedErr != nil {
		t.Fatal(persistenceTestSharedErr)
	}

	resetPersistenceTestState(t, persistenceTestSharedApp)
	return persistenceTestSharedApp
}

func resetPersistenceTestState(t *testing.T, app *tests.TestApp) {
	t.Helper()

	for _, collection := range []string{"connectors", "instances", "provider_accounts"} {
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
