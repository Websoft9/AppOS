package connectors_test

import (
	"os"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

var (
	connectorsTestBaselineOnce sync.Once
	connectorsTestBaselineDir  string
	connectorsTestBaselineErr  error
)

func TestMain(m *testing.M) {
	code := m.Run()
	if connectorsTestBaselineDir != "" {
		_ = os.RemoveAll(connectorsTestBaselineDir)
	}
	os.Exit(code)
}

func connectorsTestBaselineDataDir() (string, error) {
	connectorsTestBaselineOnce.Do(func() {
		app, err := tests.NewTestApp()
		if err != nil {
			connectorsTestBaselineErr = err
			return
		}

		connectorsTestBaselineDir = app.DataDir()
		connectorsTestBaselineErr = app.ResetBootstrapState()
	})

	return connectorsTestBaselineDir, connectorsTestBaselineErr
}
