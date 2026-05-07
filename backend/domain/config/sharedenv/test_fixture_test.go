package sharedenv_test

import (
	"os"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

var (
	sharedEnvTestBaselineOnce sync.Once
	sharedEnvTestBaselineDir  string
	sharedEnvTestBaselineErr  error
)

func TestMain(m *testing.M) {
	code := m.Run()
	if sharedEnvTestBaselineDir != "" {
		_ = os.RemoveAll(sharedEnvTestBaselineDir)
	}
	os.Exit(code)
}

func sharedEnvTestBaselineDataDir() (string, error) {
	sharedEnvTestBaselineOnce.Do(func() {
		app, err := tests.NewTestApp()
		if err != nil {
			sharedEnvTestBaselineErr = err
			return
		}

		sharedEnvTestBaselineDir = app.DataDir()
		sharedEnvTestBaselineErr = app.ResetBootstrapState()
	})

	return sharedEnvTestBaselineDir, sharedEnvTestBaselineErr
}

func newSharedEnvTestApp(t *testing.T) *tests.TestApp {
	t.Helper()

	baselineDir, err := sharedEnvTestBaselineDataDir()
	if err != nil {
		t.Fatal(err)
	}

	app, err := tests.NewTestApp(baselineDir)
	if err != nil {
		t.Fatal(err)
	}

	return app
}
