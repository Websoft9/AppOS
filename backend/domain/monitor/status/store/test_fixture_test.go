package store_test

import (
	"os"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

var (
	storeTestBaselineOnce sync.Once
	storeTestBaselineDir  string
	storeTestBaselineErr  error
)

func TestMain(m *testing.M) {
	code := m.Run()
	if storeTestBaselineDir != "" {
		_ = os.RemoveAll(storeTestBaselineDir)
	}
	os.Exit(code)
}

func newStoreTestApp(t *testing.T) *tests.TestApp {
	t.Helper()

	storeTestBaselineOnce.Do(func() {
		app, err := tests.NewTestApp()
		if err != nil {
			storeTestBaselineErr = err
			return
		}

		storeTestBaselineDir = app.DataDir()
		storeTestBaselineErr = app.ResetBootstrapState()
	})
	if storeTestBaselineErr != nil {
		t.Fatal(storeTestBaselineErr)
	}

	app, err := tests.NewTestApp(storeTestBaselineDir)
	if err != nil {
		t.Fatal(err)
	}

	return app
}
