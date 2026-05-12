package snapshots_test

import (
	"os"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

var (
	snapshotsTestBaselineOnce sync.Once
	snapshotsTestBaselineDir  string
	snapshotsTestBaselineErr  error
)

func TestMain(m *testing.M) {
	code := m.Run()
	if snapshotsTestBaselineDir != "" {
		_ = os.RemoveAll(snapshotsTestBaselineDir)
	}
	os.Exit(code)
}

func newSnapshotsTestApp(t *testing.T) *tests.TestApp {
	t.Helper()

	snapshotsTestBaselineOnce.Do(func() {
		app, err := tests.NewTestApp()
		if err != nil {
			snapshotsTestBaselineErr = err
			return
		}

		snapshotsTestBaselineDir = app.DataDir()
		snapshotsTestBaselineErr = app.ResetBootstrapState()
	})
	if snapshotsTestBaselineErr != nil {
		t.Fatal(snapshotsTestBaselineErr)
	}

	app, err := tests.NewTestApp(snapshotsTestBaselineDir)
	if err != nil {
		t.Fatal(err)
	}

	return app
}
