package platform_test

import (
	"os"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

var (
	platformTestBaselineOnce sync.Once
	platformTestBaselineDir  string
	platformTestBaselineErr  error
)

func TestMain(m *testing.M) {
	code := m.Run()
	if platformTestBaselineDir != "" {
		_ = os.RemoveAll(platformTestBaselineDir)
	}
	os.Exit(code)
}

func newPlatformTestApp(t *testing.T) *tests.TestApp {
	t.Helper()

	platformTestBaselineOnce.Do(func() {
		app, err := tests.NewTestApp()
		if err != nil {
			platformTestBaselineErr = err
			return
		}

		platformTestBaselineDir = app.DataDir()
		platformTestBaselineErr = app.ResetBootstrapState()
	})
	if platformTestBaselineErr != nil {
		t.Fatal(platformTestBaselineErr)
	}

	app, err := tests.NewTestApp(platformTestBaselineDir)
	if err != nil {
		t.Fatal(err)
	}

	return app
}
