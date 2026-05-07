package agent_test

import (
	"os"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/tests"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

var (
	agentTestBaselineOnce sync.Once
	agentTestBaselineDir  string
	agentTestBaselineErr  error
)

func TestMain(m *testing.M) {
	code := m.Run()
	if agentTestBaselineDir != "" {
		_ = os.RemoveAll(agentTestBaselineDir)
	}
	os.Exit(code)
}

func newAgentTestApp(t *testing.T) *tests.TestApp {
	t.Helper()

	agentTestBaselineOnce.Do(func() {
		app, err := tests.NewTestApp()
		if err != nil {
			agentTestBaselineErr = err
			return
		}

		agentTestBaselineDir = app.DataDir()
		agentTestBaselineErr = app.ResetBootstrapState()
	})
	if agentTestBaselineErr != nil {
		t.Fatal(agentTestBaselineErr)
	}

	app, err := tests.NewTestApp(agentTestBaselineDir)
	if err != nil {
		t.Fatal(err)
	}

	return app
}
