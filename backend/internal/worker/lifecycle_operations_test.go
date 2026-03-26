package worker

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/internal/docker"
	lifecycleruntime "github.com/websoft9/appos/backend/internal/lifecycle/runtime"
	lifecyclesvc "github.com/websoft9/appos/backend/internal/lifecycle/service"

	_ "github.com/websoft9/appos/backend/internal/migrations"
)

type fakeDockerExecutor struct{}

func (fakeDockerExecutor) Run(_ context.Context, command string, args ...string) (string, error) {
	joined := command + " " + strings.Join(args, " ")
	switch {
	case strings.Contains(joined, "compose") && strings.Contains(joined, " up "):
		return "started", nil
	case strings.Contains(joined, "compose") && strings.Contains(joined, " ps "):
		return "container-id", nil
	case strings.Contains(joined, "compose") && strings.Contains(joined, " down "):
		return "stopped", nil
	default:
		return "", nil
	}
}

func (fakeDockerExecutor) RunStream(_ context.Context, _ string, _ ...string) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}

func (fakeDockerExecutor) Ping(context.Context) error { return nil }

func (fakeDockerExecutor) Host() string { return "test" }

type fakeOperationExecutor struct{}

func (fakeOperationExecutor) PrepareWorkspace(projectDir string, compose string) error {
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(projectDir, "docker-compose.yml"), []byte(compose), 0o644)
}

func (fakeOperationExecutor) DockerClient() (*docker.Client, error) {
	return docker.New(fakeDockerExecutor{}), nil
}

func (fakeOperationExecutor) Name() string { return "fake" }

func TestHandleRunOperationCreatesReleaseAndProjection(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	oldFactory := operationExecutorFactory
	oldHealthCheck := operationHealthCheck
	operationExecutorFactory = func(app core.App, serverID string) lifecycleruntime.Executor {
		return fakeOperationExecutor{}
	}
	operationHealthCheck = func(ctx context.Context, client interface {
		Exec(context.Context, ...string) (string, error)
	}, projectDir string) error {
		return nil
	}
	defer func() {
		operationExecutorFactory = oldFactory
		operationHealthCheck = oldHealthCheck
	}()

	projectDir := filepath.Join(t.TempDir(), "demo-app")
	operation, err := lifecyclesvc.CreateOperationFromCompose(
		app,
		nil,
		lifecyclesvc.ComposeOperationRequest{
			ServerID:    "local",
			ProjectName: "Demo App",
			Compose:     "services:\n  web:\n    image: nginx:alpine\n",
			Source:      "manualops",
			Adapter:     "manual-compose",
			ResolvedEnv: map[string]any{
				"APP_ENV": "prod",
				"PORT":    8080,
			},
			ExposureIntent: &lifecyclesvc.ExposureIntent{
				Domain:     "demo.local",
				TargetPort: 8080,
				IsPrimary:  true,
			},
		},
		lifecyclesvc.ComposeOperationOptions{ProjectDir: projectDir},
	)
	if err != nil {
		t.Fatal(err)
	}

	payload, err := json.Marshal(RunOperationPayload{OperationID: operation.Id})
	if err != nil {
		t.Fatal(err)
	}

	w := &Worker{app: app}
	if err := w.handleRunOperation(context.Background(), asynq.NewTask(TaskRunOperation, payload)); err != nil {
		t.Fatal(err)
	}

	operation, err = app.FindRecordById("app_operations", operation.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := operation.GetString("terminal_status"); got != "success" {
		t.Fatalf("expected success terminal status, got %q", got)
	}
	if got := operation.GetString("app_outcome"); got != "new_release_active" {
		t.Fatalf("expected new_release_active outcome, got %q", got)
	}
	if !strings.Contains(operation.GetString("execution_log"), "operation finished successfully") {
		t.Fatal("expected execution log to contain completion entry")
	}

	appRecord, err := app.FindRecordById("app_instances", operation.GetString("app"))
	if err != nil {
		t.Fatal(err)
	}
	if got := appRecord.GetString("lifecycle_state"); got != "running_healthy" {
		t.Fatalf("expected running_healthy app lifecycle state, got %q", got)
	}
	if appRecord.GetString("current_release") == "" {
		t.Fatal("expected current_release to be set")
	}

	release, err := app.FindRecordById("app_releases", appRecord.GetString("current_release"))
	if err != nil {
		t.Fatal(err)
	}
	if got := release.GetString("release_role"); got != "active" {
		t.Fatalf("expected active release role, got %q", got)
	}
	resolvedEnv := mustJSONMap(t, release.Get("resolved_env_json"))
	if resolvedEnv["APP_ENV"] != "prod" || resolvedEnv["PORT"] != "8080" {
		t.Fatalf("unexpected release resolved_env_json: %v", resolvedEnv)
	}
	spec := mustJSONMap(t, operation.Get("spec_json"))
	if _, ok := spec["exposure_intent"].(map[string]any); !ok {
		t.Fatalf("expected exposure_intent in operation spec, got %T", spec["exposure_intent"])
	}

	pipeline, err := app.FindRecordById("pipeline_runs", operation.GetString("pipeline_run"))
	if err != nil {
		t.Fatal(err)
	}
	if got := pipeline.GetString("status"); got != "completed" {
		t.Fatalf("expected completed pipeline status, got %q", got)
	}
	if got := pipeline.GetInt("completed_node_count"); got != 5 {
		t.Fatalf("expected 5 completed nodes, got %d", got)
	}
}

func mustJSONMap(t *testing.T, value any) map[string]any {
	t.Helper()
	if direct, ok := value.(map[string]any); ok {
		return direct
	}
	var raw []byte
	switch typed := value.(type) {
	case []byte:
		raw = typed
	case string:
		raw = []byte(typed)
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			t.Fatalf("marshal json field: %v", err)
		}
		raw = encoded
	}
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("unmarshal json field: %v", err)
	}
	return parsed
}
