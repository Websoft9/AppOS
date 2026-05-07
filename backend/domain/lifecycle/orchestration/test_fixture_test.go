package orchestration_test

import (
	"os"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

var (
	orchestrationTestBaselineOnce sync.Once
	orchestrationTestBaselineDir  string
	orchestrationTestBaselineErr  error
)

func TestMain(m *testing.M) {
	code := m.Run()
	if orchestrationTestBaselineDir != "" {
		_ = os.RemoveAll(orchestrationTestBaselineDir)
	}
	os.Exit(code)
}

func orchestrationTestBaselineDataDir() (string, error) {
	orchestrationTestBaselineOnce.Do(func() {
		app, err := tests.NewTestApp()
		if err != nil {
			orchestrationTestBaselineErr = err
			return
		}

		orchestrationTestBaselineDir = app.DataDir()
		orchestrationTestBaselineErr = app.ResetBootstrapState()
	})

	return orchestrationTestBaselineDir, orchestrationTestBaselineErr
}
