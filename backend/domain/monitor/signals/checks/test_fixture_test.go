package checks_test

import (
	"os"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

var (
	checksTestBaselineOnce sync.Once
	checksTestBaselineDir  string
	checksTestBaselineErr  error
)

func TestMain(m *testing.M) {
	code := m.Run()
	if checksTestBaselineDir != "" {
		_ = os.RemoveAll(checksTestBaselineDir)
	}
	os.Exit(code)
}

func newChecksTestApp(t *testing.T) *tests.TestApp {
	t.Helper()

	checksTestBaselineOnce.Do(func() {
		app, err := tests.NewTestApp()
		if err != nil {
			checksTestBaselineErr = err
			return
		}

		checksTestBaselineDir = app.DataDir()
		checksTestBaselineErr = app.ResetBootstrapState()
	})
	if checksTestBaselineErr != nil {
		t.Fatal(checksTestBaselineErr)
	}

	app, err := tests.NewTestApp(checksTestBaselineDir)
	if err != nil {
		t.Fatal(err)
	}

	return app
}
