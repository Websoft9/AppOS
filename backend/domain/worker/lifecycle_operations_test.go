package worker

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
	lifecycleruntime "github.com/websoft9/appos/backend/domain/lifecycle/runtime"
	lifecyclesvc "github.com/websoft9/appos/backend/domain/lifecycle/service"
	"github.com/websoft9/appos/backend/infra/docker"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

type fakeDockerExecutor struct {
	running bool
}

func (f *fakeDockerExecutor) Run(_ context.Context, command string, args ...string) (string, error) {
	joined := command + " " + strings.Join(args, " ")
	switch {
	case strings.Contains(joined, "docker build -t apps/source-build-demo:candidate"):
		return "built", nil
	case strings.Contains(joined, "docker image inspect apps/source-build-demo:candidate"):
		return `[{"Id":"sha256:sourcebuilddemo123","RepoDigests":[]}]`, nil
	case strings.Contains(joined, "docker build -t apps/demo-app:candidate"):
		return "built", nil
	case strings.Contains(joined, "docker image inspect apps/demo-app:candidate"):
		return `[{"Id":"sha256:demoapp123","RepoDigests":[]}]`, nil
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
	name   string
	docker *fakeDockerExecutor
}

func (f fakeOperationExecutor) PrepareWorkspace(projectDir string, compose string) error {
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(projectDir, "docker-compose.yml"), []byte(compose), 0o600)
}

func (f fakeOperationExecutor) DockerClient() (*docker.Client, error) {
	return docker.New(f.docker), nil
}

func (f fakeOperationExecutor) Name() string {
	if strings.TrimSpace(f.name) == "" {
		return "fake"
	}
	return f.name
}

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

func TestExecuteNodeCreatesAndPromotesCandidateReleaseForSourceBuild(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	oldFactory := operationExecutorFactory
	oldHealthCheck := operationHealthCheck
	fakeDocker := &fakeDockerExecutor{}
	operationExecutorFactory = func(app core.App, serverID string) lifecycleruntime.Executor {
		return fakeOperationExecutor{name: "local", docker: fakeDocker}
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
			Source:      string(model.TriggerSourceManualOps),
			Adapter:     string(model.AdapterSourceBuild),
			SourceBuild: &lifecyclesvc.InstallSourceBuildInput{
				SourceKind:      "uploaded-package",
				SourceRef:       "apps/demo-app/src",
				WorkspaceRef:    "apps/demo-app/src",
				BuilderStrategy: "buildpacks",
				ArtifactPublication: &lifecyclesvc.InstallArtifactPublication{
					Mode:      "push",
					TargetRef: "registry://default/apps/demo-app",
					ImageName: "apps/demo-app",
				},
				ReleaseMetadata: map[string]any{
					"version_label":  "main-20260401",
					"source_label":   "uploaded source package",
					"change_summary": "Initial source-based deployment",
				},
			},
		},
		lifecyclesvc.ComposeOperationOptions{ProjectDir: projectDir},
	)
	if err != nil {
		t.Fatal(err)
	}

	operation.Set("spec_json", map[string]any{
		"source_build": map[string]any{
			"source_kind":      "uploaded-package",
			"source_ref":       "apps/demo-app/src",
			"builder_strategy": "buildpacks",
			"artifact_publication": map[string]any{
				"mode":       "local",
				"image_name": "apps/demo-app",
			},
			"deploy_inputs": map[string]any{
				"service_name": "web",
			},
			"publication_result": map[string]any{
				"status":          "local_available",
				"image_name":      "apps/demo-app",
				"image_tag":       "candidate",
				"local_image_ref": "apps/demo-app:candidate",
				"artifact_digest": "apps/demo-app:candidate",
				"recorded_at":     "2026-04-01T00:00:00Z",
			},
			"release_metadata": map[string]any{
				"version_label":  "main-20260401",
				"source_label":   "uploaded source package",
				"change_summary": "Initial source-based deployment",
			},
		},
	})
	if err := app.Save(operation); err != nil {
		t.Fatal(err)
	}

	execCtx, err := (&Worker{app: app}).loadLifecycleExecutionContext(operation.Id)
	if err != nil {
		t.Fatal(err)
	}
	nodeRun := core.NewRecord(core.NewBaseCollection("pipeline_node_runs"))
	worker := &Worker{app: app}
	if err := worker.executeNode(context.Background(), execCtx, nodeRun, model.NodeDefinition{NodeType: "release_candidate", DisplayName: "Create Candidate Release"}); err != nil {
		t.Fatal(err)
	}

	operation, err = app.FindRecordById("app_operations", operation.Id)
	if err != nil {
		t.Fatal(err)
	}
	if operation.GetString("candidate_release") == "" {
		t.Fatal("expected candidate_release to be recorded on operation")
	}

	candidateRelease, err := app.FindRecordById("app_releases", operation.GetString("candidate_release"))
	if err != nil {
		t.Fatal(err)
	}
	if got := candidateRelease.GetString("release_role"); got != "candidate" {
		t.Fatalf("expected candidate release role, got %q", got)
	}
	if candidateRelease.GetBool("is_active") {
		t.Fatal("expected candidate release to remain inactive before promotion")
	}
	if got := candidateRelease.GetString("version_label"); got != "main-20260401" {
		t.Fatalf("expected candidate version_label from source_build metadata, got %q", got)
	}
	if got := candidateRelease.GetString("artifact_digest"); got != "apps/demo-app:candidate" {
		t.Fatalf("unexpected candidate artifact_digest: %q", got)
	}
	if got := candidateRelease.GetString("notes"); !strings.Contains(got, "image=apps/demo-app:candidate") || !strings.Contains(got, "service=web") {
		t.Fatalf("expected candidate notes to include local image and target service, got %q", got)
	}

	promoted, err := worker.promoteCandidateRelease(execCtx, time.Date(2026, 4, 1, 1, 2, 3, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if promoted.Id != candidateRelease.Id {
		t.Fatalf("expected promoted release to reuse candidate release %q, got %q", candidateRelease.Id, promoted.Id)
	}

	promoted, err = app.FindRecordById("app_releases", candidateRelease.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := promoted.GetString("release_role"); got != "active" {
		t.Fatalf("expected promoted release_role active, got %q", got)
	}
	if !promoted.GetBool("is_active") || !promoted.GetBool("is_last_known_good") {
		t.Fatal("expected promoted release to be active and last known good")
	}
	if promoted.GetDateTime("activated_at").IsZero() {
		t.Fatal("expected activated_at to be set on promoted candidate release")
	}
}

func TestHandleRunOperationCompletesSourceBuildPipeline(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	oldFactory := operationExecutorFactory
	oldHealthCheck := operationHealthCheck
	fakeDocker := &fakeDockerExecutor{}
	operationExecutorFactory = func(app core.App, serverID string) lifecycleruntime.Executor {
		return fakeOperationExecutor{name: "local", docker: fakeDocker}
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

	workspaceRef := filepath.Join("apps", "source-build-e2e", time.Now().UTC().Format("20060102150405.000000000"), "src")
	sourceDir := filepath.Join("/appos/data", workspaceRef)
	defer os.RemoveAll(filepath.Dir(sourceDir))
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "package.json"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "Dockerfile"), []byte("FROM scratch\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	projectDir := filepath.Join(t.TempDir(), "demo-app")
	operation, err := lifecyclesvc.CreateOperationFromCompose(
		app,
		nil,
		lifecyclesvc.ComposeOperationRequest{
			ServerID:    "local",
			ProjectName: "Source Build Demo",
			Compose:     "services:\n  web:\n    image: nginx:alpine\n",
			Source:      string(model.TriggerSourceManualOps),
			Adapter:     string(model.AdapterSourceBuild),
			ResolvedEnv: map[string]any{
				"APP_ENV": "prod",
			},
			SourceBuild: &lifecyclesvc.InstallSourceBuildInput{
				SourceKind:      "uploaded-package",
				SourceRef:       workspaceRef,
				WorkspaceRef:    workspaceRef,
				BuilderStrategy: "buildpacks",
				ArtifactPublication: &lifecyclesvc.InstallArtifactPublication{
					Mode:      "local",
					ImageName: "apps/source-build-demo",
				},
				ReleaseMetadata: map[string]any{
					"version_label":  "source-build-demo-20260401",
					"source_label":   "uploaded source package",
					"change_summary": "Source build pipeline e2e",
				},
			},
		},
		lifecyclesvc.ComposeOperationOptions{ProjectDir: projectDir},
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
	if operation.GetString("candidate_release") == "" {
		t.Fatal("expected candidate_release to be set")
	}
	if operation.GetString("result_release") == "" {
		t.Fatal("expected result_release to be set")
	}
	if operation.GetString("candidate_release") != operation.GetString("result_release") {
		t.Fatalf("expected candidate_release and result_release to match, got candidate=%q result=%q", operation.GetString("candidate_release"), operation.GetString("result_release"))
	}

	spec := mustJSONMap(t, operation.Get("spec_json"))
	sourceBuild, ok := spec["source_build"].(map[string]any)
	if !ok {
		t.Fatalf("expected source_build in operation spec, got %T", spec["source_build"])
	}
	buildResult, ok := sourceBuild["build_result"].(map[string]any)
	if !ok {
		t.Fatalf("expected build_result map, got %T", sourceBuild["build_result"])
	}
	if buildResult["status"] != "local_image_built" {
		t.Fatalf("unexpected build_result.status: %v", buildResult["status"])
	}
	if buildResult["local_image_ref"] != "apps/source-build-demo:candidate" {
		t.Fatalf("unexpected build_result.local_image_ref: %v", buildResult["local_image_ref"])
	}
	if buildResult["local_image_id"] != "sha256:sourcebuilddemo123" {
		t.Fatalf("unexpected build_result.local_image_id: %v", buildResult["local_image_id"])
	}
	publicationResult, ok := sourceBuild["publication_result"].(map[string]any)
	if !ok {
		t.Fatalf("expected publication_result map, got %T", sourceBuild["publication_result"])
	}
	if publicationResult["status"] != "local_available" {
		t.Fatalf("unexpected publication_result.status: %v", publicationResult["status"])
	}
	if publicationResult["artifact_digest"] != "apps/source-build-demo:candidate" {
		t.Fatalf("unexpected publication_result.artifact_digest: %v", publicationResult["artifact_digest"])
	}
	if publicationResult["local_image_ref"] != "apps/source-build-demo:candidate" {
		t.Fatalf("unexpected publication_result.local_image_ref: %v", publicationResult["local_image_ref"])
	}

	if _, err := os.Stat(filepath.Join(projectDir, "src", "package.json")); err != nil {
		t.Fatalf("expected hydrated source package.json, got %v", err)
	}
	composeBytes, err := os.ReadFile(filepath.Join(projectDir, "docker-compose.yml"))
	if err != nil {
		t.Fatalf("expected rendered compose file, got %v", err)
	}
	composeText := string(composeBytes)
	if !strings.Contains(composeText, "image: apps/source-build-demo:candidate") {
		t.Fatalf("expected rendered compose to reference built local image, got %q", composeText)
	}
	if strings.Contains(composeText, "image: nginx:alpine") {
		t.Fatalf("expected rendered compose to replace original image, got %q", composeText)
	}

	appRecord, err := app.FindRecordById("app_instances", operation.GetString("app"))
	if err != nil {
		t.Fatal(err)
	}
	if got := appRecord.GetString("lifecycle_state"); got != "running_healthy" {
		t.Fatalf("expected running_healthy app lifecycle state, got %q", got)
	}
	if appRecord.GetString("current_release") != operation.GetString("result_release") {
		t.Fatalf("expected current_release to match result_release, got current=%q result=%q", appRecord.GetString("current_release"), operation.GetString("result_release"))
	}

	release, err := app.FindRecordById("app_releases", operation.GetString("result_release"))
	if err != nil {
		t.Fatal(err)
	}
	if got := release.GetString("release_role"); got != "active" {
		t.Fatalf("expected promoted source-build release to be active, got %q", got)
	}
	if got := release.GetString("version_label"); got != "source-build-demo-20260401" {
		t.Fatalf("unexpected promoted version_label: %q", got)
	}
	if got := release.GetString("artifact_digest"); got != "apps/source-build-demo:candidate" {
		t.Fatalf("unexpected promoted artifact_digest: %q", got)
	}

	pipeline, err := app.FindRecordById("pipeline_runs", operation.GetString("pipeline_run"))
	if err != nil {
		t.Fatal(err)
	}
	if got := pipeline.GetString("status"); got != "completed" {
		t.Fatalf("expected completed pipeline status, got %q", got)
	}
	if got := pipeline.GetInt("completed_node_count"); got != 9 {
		t.Fatalf("expected 9 completed source-build nodes, got %d", got)
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
