package migrations_test

import (
	"os"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

var (
	migrationsTestBaselineOnce sync.Once
	migrationsTestBaselineDir  string
	migrationsTestBaselineErr  error
	migrationsTestSharedOnce   sync.Once
	migrationsTestSharedApp    *tests.TestApp
	migrationsTestSharedErr    error
)

func TestMain(m *testing.M) {
	code := m.Run()
	if migrationsTestSharedApp != nil {
		migrationsTestSharedApp.Cleanup()
	}
	if migrationsTestBaselineDir != "" {
		_ = os.RemoveAll(migrationsTestBaselineDir)
	}
	os.Exit(code)
}

func migrationsTestBaselineDataDir() (string, error) {
	migrationsTestBaselineOnce.Do(func() {
		app, err := tests.NewTestApp()
		if err != nil {
			migrationsTestBaselineErr = err
			return
		}

		migrationsTestBaselineDir = app.DataDir()
		migrationsTestBaselineErr = app.ResetBootstrapState()
	})

	return migrationsTestBaselineDir, migrationsTestBaselineErr
}

func newMigrationsTestApp(t *testing.T) *tests.TestApp {
	t.Helper()

	migrationsTestSharedOnce.Do(func() {
		baselineDir, err := migrationsTestBaselineDataDir()
		if err != nil {
			migrationsTestSharedErr = err
			return
		}

		migrationsTestSharedApp, err = tests.NewTestApp(baselineDir)
		if err != nil {
			migrationsTestSharedErr = err
		}
	})
	if migrationsTestSharedErr != nil {
		t.Fatal(migrationsTestSharedErr)
	}

	return migrationsTestSharedApp
}

func newIsolatedMigrationsTestApp(t *testing.T) *tests.TestApp {
	t.Helper()

	baselineDir, err := migrationsTestBaselineDataDir()
	if err != nil {
		t.Fatal(err)
	}

	app, err := tests.NewTestApp(baselineDir)
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() {
		app.Cleanup()
	})

	return app
}