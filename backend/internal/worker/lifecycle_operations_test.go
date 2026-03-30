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
	"github.com/websoft9/appos/backend/internal/lifecycle/model"
	lifecycleruntime "github.com/websoft9/appos/backend/internal/lifecycle/runtime"
	lifecyclesvc "github.com/websoft9/appos/backend/internal/lifecycle/service"

	_ "github.com/websoft9/appos/backend/internal/migrations"
)

type fakeDockerExecutor struct {
	running bool
}

func (f *fakeDockerExecutor) Run(_ context.Context, command string, args ...string) (string, error) {
	joined := command + " " + strings.Join(args, " ")
	switch {
	case strings.Contains(joined, "compose") && strings.Contains(joined, " up "):
		f.running = true
		return "started", nil
	case strings.Contains(joined, "compose") && strings.Contains(joined, " start"):
		f.running = true
		return "started", nil
	case strings.Contains(joined, "compose") && strings.Contains(joined, " stop"):
		f.running = false
		return "stopped", nil
	case strings.Contains(joined, "compose") && strings.Contains(joined, " restart"):
		f.running = true
		return "restarted", nil
	case strings.Contains(joined, "compose") && strings.Contains(joined, " ps "):
		if f.running {
			return "container-id", nil
		}
		return "", nil
	case strings.Contains(joined, "compose") && strings.Contains(joined, " down "):
		f.running = false
		return "stopped", nil
	default:
		return "", nil
	}
}

func (*fakeDockerExecutor) RunStream(_ context.Context, _ string, _ ...string) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}

func (*fakeDockerExecutor) Ping(context.Context) error { return nil }

func (*fakeDockerExecutor) Host() string { return "test" }

type fakeOperationExecutor struct {
	docker *fakeDockerExecutor
}

func (f fakeOperationExecutor) PrepareWorkspace(projectDir string, compose string) error {
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(projectDir, "docker-compose.yml"), []byte(compose), 0o644)
}

func (f fakeOperationExecutor) DockerClient() (*docker.Client, error) {
	return docker.New(f.docker), nil
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
	fakeDocker := &fakeDockerExecutor{}
	operationExecutorFactory = func(app core.App, serverID string) lifecycleruntime.Executor {
		return fakeOperationExecutor{docker: fakeDocker}
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

func TestHandleRunOperationStopRestartAndUninstallUseExistingReleaseState(t *testing.T) {
	cases := []struct {
		name               string
		operationType      string
		initialRunning     bool
		expectLifecycle    string
		expectHealth       string
		expectCurrentClear bool
		expectResultClear  bool
		expectOutcome      string
	}{
		{name: "stop", operationType: string(model.OperationTypeStop), initialRunning: true, expectLifecycle: string(model.AppStateStopped), expectHealth: string(model.HealthStopped), expectOutcome: "previous_release_active"},
		{name: "restart", operationType: string(model.OperationTypeRestart), initialRunning: true, expectLifecycle: string(model.AppStateRunningHealthy), expectHealth: string(model.HealthHealthy), expectOutcome: "previous_release_active"},
		{name: "uninstall", operationType: string(model.OperationTypeUninstall), initialRunning: true, expectLifecycle: string(model.AppStateRetired), expectHealth: string(model.HealthStopped), expectCurrentClear: true, expectResultClear: true, expectOutcome: "no_healthy_release"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app, err := tests.NewTestApp()
			if err != nil {
				t.Fatal(err)
			}
			defer app.Cleanup()

			oldFactory := operationExecutorFactory
			oldHealthCheck := operationHealthCheck
			fakeDocker := &fakeDockerExecutor{running: tc.initialRunning}
			operationExecutorFactory = func(app core.App, serverID string) lifecycleruntime.Executor {
				return fakeOperationExecutor{docker: fakeDocker}
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
			installOperation, err := lifecyclesvc.CreateOperationFromCompose(
				app,
				nil,
				lifecyclesvc.ComposeOperationRequest{
					ServerID:    "local",
					ProjectName: "Demo App",
					Compose:     "services:\n  web:\n    image: nginx:alpine\n",
					Source:      string(model.TriggerSourceManualOps),
					Adapter:     string(model.AdapterManualCompose),
				},
				lifecyclesvc.ComposeOperationOptions{ProjectDir: projectDir},
			)
			if err != nil {
				t.Fatal(err)
			}
			if err := runTestOperation(app, installOperation.Id); err != nil {
				t.Fatal(err)
			}

			appRecord, err := app.FindRecordById("app_instances", installOperation.GetString("app"))
			if err != nil {
				t.Fatal(err)
			}
			previousRelease := appRecord.GetString("current_release")
			if previousRelease == "" {
				t.Fatal("expected current_release after install")
			}

			metadata := map[string]any{}
			if tc.operationType == string(model.OperationTypeUninstall) {
				metadata["remove_volumes"] = true
			}
			operation, err := lifecyclesvc.CreateOperationFromCompose(
				app,
				nil,
				lifecyclesvc.ComposeOperationRequest{
					ServerID:    "local",
					ProjectName: "Demo App",
					Compose:     "services:\n  web:\n    image: nginx:alpine\n",
					Source:      string(model.TriggerSourceManualOps),
					Adapter:     string(model.AdapterManualCompose),
					Metadata:    metadata,
				},
				lifecyclesvc.ComposeOperationOptions{
					ExistingAppID:      appRecord.Id,
					OperationType:      tc.operationType,
					ProjectDir:         projectDir,
					ComposeProjectName: appRecord.GetString("name"),
				},
			)
			if err != nil {
				t.Fatal(err)
			}
			if err := runTestOperation(app, operation.Id); err != nil {
				t.Fatal(err)
			}

			operation, err = app.FindRecordById("app_operations", operation.Id)
			if err != nil {
				t.Fatal(err)
			}
			if got := operation.GetString("terminal_status"); got != "success" {
				t.Fatalf("expected success terminal status, got %q", got)
			}
			if got := operation.GetString("app_outcome"); got != tc.expectOutcome {
				t.Fatalf("expected app_outcome %q, got %q", tc.expectOutcome, got)
			}
			if tc.expectResultClear && operation.GetString("result_release") != "" {
				t.Fatalf("expected empty result_release, got %q", operation.GetString("result_release"))
			}

			appRecord, err = app.FindRecordById("app_instances", appRecord.Id)
			if err != nil {
				t.Fatal(err)
			}
			if got := appRecord.GetString("lifecycle_state"); got != tc.expectLifecycle {
				t.Fatalf("expected lifecycle_state %q, got %q", tc.expectLifecycle, got)
			}
			if got := appRecord.GetString("health_summary"); got != tc.expectHealth {
				t.Fatalf("expected health_summary %q, got %q", tc.expectHealth, got)
			}
			if tc.expectCurrentClear {
				if appRecord.GetString("current_release") != "" {
					t.Fatalf("expected current_release cleared, got %q", appRecord.GetString("current_release"))
				}
				if appRecord.GetDateTime("retired_at").IsZero() {
					t.Fatal("expected retired_at to be set")
				}
				release, err := app.FindRecordById("app_releases", previousRelease)
				if err != nil {
					t.Fatal(err)
				}
				if release.GetBool("is_active") {
					t.Fatal("expected previous release to be deactivated")
				}
			} else if appRecord.GetString("current_release") != previousRelease {
				t.Fatalf("expected current_release to remain %q, got %q", previousRelease, appRecord.GetString("current_release"))
			}
		})
	}
}

func runTestOperation(app core.App, operationID string) error {
	payload, err := json.Marshal(RunOperationPayload{OperationID: operationID})
	if err != nil {
		return err
	}
	w := &Worker{app: app}
	return w.handleRunOperation(context.Background(), asynq.NewTask(TaskRunOperation, payload))
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
