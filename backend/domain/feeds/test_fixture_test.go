package feeds

import (
	"os"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

var (
	feedsTestBaselineOnce sync.Once
	feedsTestBaselineDir  string
	feedsTestBaselineErr  error
)

func TestMain(m *testing.M) {
	code := m.Run()
	if feedsTestBaselineDir != "" {
		_ = os.RemoveAll(feedsTestBaselineDir)
	}
	os.Exit(code)
}

func feedsTestBaselineDataDir() (string, error) {
	feedsTestBaselineOnce.Do(func() {
		app, err := tests.NewTestApp()
		if err != nil {
			feedsTestBaselineErr = err
			return
		}
		feedsTestBaselineDir = app.DataDir()
		feedsTestBaselineErr = app.ResetBootstrapState()
	})
	return feedsTestBaselineDir, feedsTestBaselineErr
}

func newFeedsTestApp(t *testing.T) *tests.TestApp {
	t.Helper()

	baselineDir, err := feedsTestBaselineDataDir()
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
