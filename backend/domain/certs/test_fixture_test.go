package certs

import (
	"os"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

var (
	certsTestBaselineOnce sync.Once
	certsTestBaselineDir  string
	certsTestBaselineErr  error
)

func TestMain(m *testing.M) {
	code := m.Run()
	if certsTestBaselineDir != "" {
		_ = os.RemoveAll(certsTestBaselineDir)
	}
	os.Exit(code)
}

func certsTestBaselineDataDir() (string, error) {
	certsTestBaselineOnce.Do(func() {
		app, err := tests.NewTestApp()
		if err != nil {
			certsTestBaselineErr = err
			return
		}

		certsTestBaselineDir = app.DataDir()
		certsTestBaselineErr = app.ResetBootstrapState()
	})

	return certsTestBaselineDir, certsTestBaselineErr
}

func newCertsTestApp(t *testing.T) *tests.TestApp {
	t.Helper()

	baselineDir, err := certsTestBaselineDataDir()
	if err != nil {
		t.Fatal(err)
	}

	app, err := tests.NewTestApp(baselineDir)
	if err != nil {
		t.Fatal(err)
	}

	return app
}
