package runtime

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
	"github.com/websoft9/appos/backend/infra/docker"
	_ "github.com/websoft9/appos/backend/infra/migrations"
)

type noopExecutor struct{}

func (noopExecutor) Name() string                          { return "local" }
func (noopExecutor) PrepareWorkspace(string, string) error { return nil }
func (noopExecutor) DockerClient() (*docker.Client, error) { return nil, nil }

type buildDockerExecutor struct{}

func (buildDockerExecutor) Run(_ context.Context, command string, args ...string) (string, error) {
	joined := command + " " + strings.Join(args, " ")
	switch {
	case strings.Contains(joined, "docker build -t apps/demo-app:candidate"):
		return "built", nil
	case strings.Contains(joined, "docker image inspect apps/demo-app:candidate"):
		return `[{"Id":"sha256:localbuild123","RepoDigests":[]}]`, nil
	case strings.Contains(joined, "docker image inspect registry.example.com/apps/demo-app:candidate"):
		return `[{"RepoDigests":["registry.example.com/apps/demo-app@sha256:abc123"]}]`, nil
	default:
		return "", nil
	}
}

func (buildDockerExecutor) RunStream(context.Context, string, ...string) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}

func (buildDockerExecutor) Ping(context.Context) error { return nil }
func (buildDockerExecutor) Host() string               { return "local" }

type buildExecutor struct{}

func (buildExecutor) Name() string                          { return "local" }
func (buildExecutor) PrepareWorkspace(string, string) error { return nil }
func (buildExecutor) DockerClient() (*docker.Client, error) {
	return docker.New(buildDockerExecutor{}), nil
}

type runtimeDockerExecutor struct {
	available bool
}

func (e *runtimeDockerExecutor) Run(_ context.Context, command string, args ...string) (string, error) {
	joined := command + " " + strings.Join(args, " ")
	switch {
	case strings.Contains(joined, "docker image inspect postgres:16"):
		if e.available {
			return `[{"Id":"sha256:postgres16local"}]`, nil
		}
		return "", errors.New("missing")
	case strings.Contains(joined, "docker pull postgres:16"):
		e.available = true
		return "Pulling postgres:16\nDownloading layer sha256:123\nDownloading layer sha256:123\nPull complete\n", nil
	case strings.Contains(joined, "docker compose -f /tmp/demo-app/docker-compose.yml up -d"):
		return "runtime started", nil
	default:
		return "", nil
	}
}

func (*runtimeDockerExecutor) RunStream(_ context.Context, command string, args ...string) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}

func (*runtimeDockerExecutor) Ping(context.Context) error { return nil }
func (*runtimeDockerExecutor) Host() string               { return "local" }

type runtimeNetworkDockerExecutor struct {
	commands []string
	created  map[string]bool
}

func (e *runtimeNetworkDockerExecutor) Run(_ context.Context, command string, args ...string) (string, error) {
	joined := command + " " + strings.Join(args, " ")
	e.commands = append(e.commands, joined)
	switch {
	case strings.Contains(joined, "docker network inspect websoft9"):
		if e.created != nil && e.created["websoft9"] {
			return "[{\"Name\":\"websoft9\"}]", nil
		}
		return "", errors.New("network not found")
	case strings.Contains(joined, "docker network create websoft9"):
		if e.created == nil {
			e.created = map[string]bool{}
		}
		e.created["websoft9"] = true
		return "websoft9", nil
	case strings.Contains(joined, "docker image inspect nginx:alpine"):
		return `[{"Id":"sha256:nginxlocal"}]`, nil
	case strings.Contains(joined, "docker pull nginx:alpine"):
		return "Pull complete\n", nil
	case strings.Contains(joined, "docker compose -f /tmp/demo-app/docker-compose.yml up -d"):
		return "runtime started", nil
	default:
		return "", nil
	}
}

func (e *runtimeNetworkDockerExecutor) RunStream(_ context.Context, command string, args ...string) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}

func (e *runtimeNetworkDockerExecutor) Ping(context.Context) error { return nil }
func (e *runtimeNetworkDockerExecutor) Host() string               { return "local" }

type runtimeNetworkExecutor struct{ exec *runtimeNetworkDockerExecutor }

func (runtimeNetworkExecutor) Name() string                          { return "local" }
func (runtimeNetworkExecutor) PrepareWorkspace(string, string) error { return nil }
func (e runtimeNetworkExecutor) DockerClient() (*docker.Client, error) {
	return docker.New(e.exec), nil
}

type runtimeExecutor struct{}

func (runtimeExecutor) Name() string                          { return "local" }
func (runtimeExecutor) PrepareWorkspace(string, string) error { return nil }
func (runtimeExecutor) DockerClient() (*docker.Client, error) {
	return docker.New(&runtimeDockerExecutor{}), nil
}

type runtimeLocalImageDockerExecutor struct {
	commands []string
}

func (e *runtimeLocalImageDockerExecutor) Run(_ context.Context, command string, args ...string) (string, error) {
	joined := strings.TrimSpace(command + " " + strings.Join(args, " "))
	e.commands = append(e.commands, joined)
	if strings.Contains(joined, "docker image inspect postgres:16") {
		return `[{"Id":"sha256:postgres16local"}]`, nil
	}
	return "", nil
}

func (*runtimeLocalImageDockerExecutor) RunStream(_ context.Context, command string, args ...string) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}

func (*runtimeLocalImageDockerExecutor) Ping(context.Context) error { return nil }
func (*runtimeLocalImageDockerExecutor) Host() string               { return "local" }

type runtimeLocalImageExecutor struct {
	exec *runtimeLocalImageDockerExecutor
}

func (runtimeLocalImageExecutor) Name() string                          { return "local" }
func (runtimeLocalImageExecutor) PrepareWorkspace(string, string) error { return nil }
func (e runtimeLocalImageExecutor) DockerClient() (*docker.Client, error) {
	return docker.New(e.exec), nil
}

type mirrorAwareRuntimeDockerExecutor struct {
	commands        []string
	pullErrSeq      map[string][]error
	available       map[string]bool
	upstreamPullErr error
}

func (e *mirrorAwareRuntimeDockerExecutor) Run(_ context.Context, command string, args ...string) (string, error) {
	joined := strings.TrimSpace(command + " " + strings.Join(args, " "))
	e.commands = append(e.commands, joined)
	switch {
	case strings.Contains(joined, "docker image inspect nginx:alpine"):
		if e.available != nil && e.available["nginx:alpine"] {
			return `[{"Id":"sha256:nginxlocal"}]`, nil
		}
		return "", errors.New("missing")
	case strings.Contains(joined, "docker image inspect postgres:16"):
		if e.available != nil && e.available["postgres:16"] {
			return `[{"Id":"sha256:postgreslocal"}]`, nil
		}
		return "", errors.New("missing")
	case strings.Contains(joined, "docker pull "):
		if strings.Contains(joined, "docker pull nginx:alpine") && e.upstreamPullErr != nil {
			return "", e.upstreamPullErr
		}
		for imageRef, seq := range e.pullErrSeq {
			if strings.Contains(joined, "docker pull "+imageRef) {
				if len(seq) == 0 {
					if e.available == nil {
						e.available = map[string]bool{}
					}
					e.available[imageRef] = true
					return "Pulling nginx:alpine\nPull complete\n", nil
				}
				err := seq[0]
				e.pullErrSeq[imageRef] = seq[1:]
				if err != nil {
					return "", err
				}
				if e.available == nil {
					e.available = map[string]bool{}
				}
				e.available[imageRef] = true
				return "Pulling nginx:alpine\nPull complete\n", nil
			}
		}
		if e.available == nil {
			e.available = map[string]bool{}
		}
		if strings.Contains(joined, "docker pull postgres:16") {
			e.available["postgres:16"] = true
			return "Pulling postgres:16\nPull complete\n", nil
		}
		e.available["nginx:alpine"] = true
		return "Pulling nginx:alpine\nPull complete\n", nil
	case strings.Contains(joined, "docker image tag mirror.example.com/library/nginx:alpine nginx:alpine"):
		if e.available == nil {
			e.available = map[string]bool{}
		}
		e.available["nginx:alpine"] = true
		return "tagged", nil
	case strings.Contains(joined, "docker image tag mirror-b.example.com/library/nginx:alpine nginx:alpine"):
		if e.available == nil {
			e.available = map[string]bool{}
		}
		e.available["nginx:alpine"] = true
		return "tagged", nil
	default:
		return "", nil
	}
}

func (e *mirrorAwareRuntimeDockerExecutor) RunStream(_ context.Context, command string, args ...string) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}

func (e *mirrorAwareRuntimeDockerExecutor) Ping(context.Context) error { return nil }
func (e *mirrorAwareRuntimeDockerExecutor) Host() string               { return "local" }

type mirrorAwareRuntimeExecutor struct {
	app  core.App
	exec *mirrorAwareRuntimeDockerExecutor
}

func (e mirrorAwareRuntimeExecutor) Name() string                          { return "local" }
func (e mirrorAwareRuntimeExecutor) PrepareWorkspace(string, string) error { return nil }
func (e mirrorAwareRuntimeExecutor) DockerClient() (*docker.Client, error) {
	return docker.New(e.exec), nil
}
func (e mirrorAwareRuntimeExecutor) App() core.App { return e.app }

type publishDockerExecutor struct{}

func (publishDockerExecutor) Run(_ context.Context, command string, args ...string) (string, error) {
	joined := command + " " + strings.Join(args, " ")
	switch {
	case strings.Contains(joined, "docker build -t apps/demo-app:candidate"):
		return "built", nil
	case strings.Contains(joined, "docker image inspect apps/demo-app:candidate"):
		return `[{"Id":"sha256:localbuild123","RepoDigests":[]}]`, nil
	case strings.Contains(joined, "docker image tag apps/demo-app:candidate registry.example.com/apps/demo-app:candidate"):
		return "", nil
	case strings.Contains(joined, "docker image push registry.example.com/apps/demo-app:candidate"):
		return "pushed", nil
	case strings.Contains(joined, "docker image inspect registry.example.com/apps/demo-app:candidate"):
		return `[{"RepoDigests":["registry.example.com/apps/demo-app@sha256:abc123"]}]`, nil
	default:
		return "", nil
	}
}

func (publishDockerExecutor) RunStream(context.Context, string, ...string) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}

func (publishDockerExecutor) Ping(context.Context) error { return nil }
func (publishDockerExecutor) Host() string               { return "local" }

type publishExecutor struct{}

func (publishExecutor) Name() string                          { return "local" }
func (publishExecutor) PrepareWorkspace(string, string) error { return nil }
func (publishExecutor) DockerClient() (*docker.Client, error) {
	return docker.New(publishDockerExecutor{}), nil
}

func TestExecuteNodeRegistersAndRemovesPublicationRouteForLocalTraefik(t *testing.T) {
	tmpDir := t.TempDir()
	oldConfigDir := publicationDynamicConfigDir
	oldServicePath := publicationServicePath
	oldCommandRunner := runLocalLifecycleCommand
	publicationDynamicConfigDir = tmpDir
	publicationServicePath = filepath.Join(tmpDir, "service", "traefik")
	if err := os.MkdirAll(filepath.Dir(publicationServicePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(publicationServicePath, []byte(""), 0o600); err != nil {
		t.Fatal(err)
	}
	var commands []string
	runLocalLifecycleCommand = func(_ context.Context, command string, args ...string) (string, error) {
		commands = append(commands, strings.TrimSpace(command+" "+strings.Join(args, " ")))
		joined := strings.Join(args, " ")
		if strings.Contains(joined, "sv status") {
			if strings.Contains(joined, publicationServicePath) {
				if len(commands) > 0 && strings.Contains(commands[len(commands)-2], "sv down") {
					return "down: traefik: 1s", nil
				}
				return "run: traefik: (pid 123) 1s", nil
			}
		}
		return "", nil
	}
	defer func() {
		publicationDynamicConfigDir = oldConfigDir
		publicationServicePath = oldServicePath
		runLocalLifecycleCommand = oldCommandRunner
	}()

	operation := core.NewRecord(core.NewBaseCollection("app_operations"))
	operation.Set("app", "app-123")
	operation.Set("operation_type", string(model.OperationTypePublish))
	operation.Set("spec_json", map[string]any{
		"exposure_intent": map[string]any{
			"exposure_type": "domain",
			"domain":        "demo.local",
			"target_port":   8080,
		},
	})

	if _, err := ExecuteNode(context.Background(), operation, model.NodeDefinition{NodeType: "exposure"}, localExecutor{}, nil, NodeExecutionHooks{}); err != nil {
		t.Fatalf("register publication route: %v", err)
	}
	configPath := filepath.Join(tmpDir, "app-app-123.yml")
	content, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("expected publication config file: %v", err)
	}
	if !strings.Contains(string(content), "host.docker.internal:8080") {
		t.Fatalf("expected host-gateway upstream in config, got %q", string(content))
	}
	if !strings.Contains(strings.Join(commands, "\n"), "sv up '") || !strings.Contains(strings.Join(commands, "\n"), publicationServicePath) {
		t.Fatalf("expected sv up command, got %v", commands)
	}
	if _, err := ExecuteNode(context.Background(), operation, model.NodeDefinition{NodeType: "exposure_check"}, localExecutor{}, nil, NodeExecutionHooks{}); err != nil {
		t.Fatalf("verify publication route: %v", err)
	}

	operation.Set("operation_type", string(model.OperationTypeUnpublish))
	if _, err := ExecuteNode(context.Background(), operation, model.NodeDefinition{NodeType: "exposure"}, localExecutor{}, nil, NodeExecutionHooks{}); err != nil {
		t.Fatalf("remove publication route: %v", err)
	}
	if _, err := os.Stat(configPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expected publication config removal, got err=%v", err)
	}
	if !strings.Contains(strings.Join(commands, "\n"), "sv down '") || !strings.Contains(strings.Join(commands, "\n"), publicationServicePath) {
		t.Fatalf("expected sv down command, got %v", commands)
	}
	if _, err := ExecuteNode(context.Background(), operation, model.NodeDefinition{NodeType: "exposure_check"}, localExecutor{}, nil, NodeExecutionHooks{}); err != nil {
		t.Fatalf("verify publication removal: %v", err)
	}
}

func TestExecuteNodeHydratesSourceWorkspaceFromWorkspaceRef(t *testing.T) {
	tmpDir := t.TempDir()
	oldBasePath := sourceWorkspaceBasePath
	sourceWorkspaceBasePath = tmpDir
	defer func() {
		sourceWorkspaceBasePath = oldBasePath
	}()

	sourceDir := filepath.Join(tmpDir, "apps", "demo-app", "src")
	if err := os.MkdirAll(sourceDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "app.tar.gz"), []byte("archive-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(sourceDir, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sourceDir, "nested", "build.env"), []byte("NODE_ENV=production\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	projectDir := filepath.Join(tmpDir, "operations", "demo-app")
	operation := core.NewRecord(core.NewBaseCollection("app_operations"))
	operation.Set("project_dir", projectDir)
	operation.Set("spec_json", map[string]any{
		"source_build": map[string]any{
			"workspace_ref": "apps/demo-app/src",
		},
	})

	_, err := ExecuteNode(context.Background(), operation, model.NodeDefinition{NodeType: "source_workspace"}, noopExecutor{}, nil, NodeExecutionHooks{})
	if err != nil {
		t.Fatalf("expected source_workspace hydration to succeed, got %v", err)
	}

	data, err := os.ReadFile(filepath.Join(projectDir, "src", "app.tar.gz"))
	if err != nil {
		t.Fatalf("expected hydrated file in project_dir/src, got %v", err)
	}
	if string(data) != "archive-bytes" {
		t.Fatalf("unexpected hydrated file content: %q", string(data))
	}
	if _, err := os.Stat(filepath.Join(projectDir, "src", "nested", "build.env")); err != nil {
		t.Fatalf("expected nested hydrated file, got %v", err)
	}
}

func TestExecuteNodeBuildsLocalArtifactImage(t *testing.T) {
	tmpDir := t.TempDir()
	projectDir := filepath.Join(tmpDir, "operations", "demo-app")
	if err := os.MkdirAll(filepath.Join(projectDir, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(projectDir, "src", "package.json"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	operation := core.NewRecord(core.NewBaseCollection("app_operations"))
	operation.Set("project_dir", projectDir)
	operation.Set("spec_json", map[string]any{
		"source_build": map[string]any{
			"builder_strategy": "buildpacks",
			"artifact_publication": map[string]any{
				"mode":       "push",
				"image_name": "apps/demo-app",
				"target_ref": "registry://default/apps/demo-app",
			},
		},
	})

	result, err := ExecuteNode(context.Background(), operation, model.NodeDefinition{NodeType: "artifact_build"}, buildExecutor{}, nil, NodeExecutionHooks{})
	if err != nil {
		t.Fatalf("expected artifact_build to succeed, got %v", err)
	}
	if !result.OperationChanged {
		t.Fatal("expected artifact_build to mark operation as changed")
	}
	if result.DockerClient == nil {
		t.Fatal("expected artifact_build to retain docker client after build")
	}

	spec := operation.Get("spec_json").(map[string]any)
	sourceBuild := spec["source_build"].(map[string]any)
	buildResult, ok := sourceBuild["build_result"].(map[string]any)
	if !ok {
		t.Fatalf("expected build_result map, got %T", sourceBuild["build_result"])
	}
	if buildResult["status"] != "local_image_built" {
		t.Fatalf("expected local_image_built status, got %v", buildResult["status"])
	}
	if buildResult["source_dir"] != filepath.Join(projectDir, "src") {
		t.Fatalf("unexpected source_dir: %v", buildResult["source_dir"])
	}
	if buildResult["image_name"] != "apps/demo-app" {
		t.Fatalf("unexpected image_name: %v", buildResult["image_name"])
	}
	if buildResult["image_tag"] != "candidate" {
		t.Fatalf("unexpected image_tag: %v", buildResult["image_tag"])
	}
	if buildResult["local_image_ref"] != "apps/demo-app:candidate" {
		t.Fatalf("unexpected local_image_ref: %v", buildResult["local_image_ref"])
	}
	if buildResult["local_image_id"] != "sha256:localbuild123" {
		t.Fatalf("unexpected local_image_id: %v", buildResult["local_image_id"])
	}
	if buildResult["expected_artifact_kind"] != "oci-image" {
		t.Fatalf("expected default expected_artifact_kind, got %v", buildResult["expected_artifact_kind"])
	}
	if strings.TrimSpace(buildResult["recorded_at"].(string)) == "" {
		t.Fatal("expected recorded_at timestamp")
	}
}

func TestExecuteNodeRecordsArtifactPublishLocalAvailability(t *testing.T) {
	operation := core.NewRecord(core.NewBaseCollection("app_operations"))
	operation.Set("project_dir", "/tmp/demo-app")
	operation.Set("spec_json", map[string]any{
		"source_build": map[string]any{
			"artifact_publication": map[string]any{
				"mode":       "local",
				"image_name": "apps/demo-app",
			},
			"build_result": map[string]any{
				"status":                 "local_image_built",
				"expected_artifact_kind": "oci-image",
				"local_image_ref":        "apps/demo-app:candidate",
			},
		},
	})

	result, err := ExecuteNode(context.Background(), operation, model.NodeDefinition{NodeType: "artifact_publish"}, noopExecutor{}, nil, NodeExecutionHooks{})
	if err != nil {
		t.Fatalf("expected artifact_publish placeholder to succeed, got %v", err)
	}
	if !result.OperationChanged {
		t.Fatal("expected artifact_publish to mark operation as changed")
	}

	spec := operation.Get("spec_json").(map[string]any)
	sourceBuild := spec["source_build"].(map[string]any)
	publicationResult, ok := sourceBuild["publication_result"].(map[string]any)
	if !ok {
		t.Fatalf("expected publication_result map, got %T", sourceBuild["publication_result"])
	}
	if publicationResult["status"] != "local_available" {
		t.Fatalf("unexpected publication status: %v", publicationResult["status"])
	}
	if publicationResult["publication_mode"] != "local" {
		t.Fatalf("unexpected publication_mode: %v", publicationResult["publication_mode"])
	}
	if publicationResult["image_name"] != "apps/demo-app" {
		t.Fatalf("unexpected publication image_name: %v", publicationResult["image_name"])
	}
	if publicationResult["image_tag"] != "candidate" {
		t.Fatalf("expected default image_tag candidate, got %v", publicationResult["image_tag"])
	}
	if publicationResult["artifact_digest"] != "apps/demo-app:candidate" {
		t.Fatalf("expected publication_result artifact_digest, got %v", publicationResult["artifact_digest"])
	}
	if publicationResult["local_image_ref"] != "apps/demo-app:candidate" {
		t.Fatalf("unexpected local_image_ref: %v", publicationResult["local_image_ref"])
	}
	if publicationResult["resolved_target_ref"] != nil {
		t.Fatalf("expected no resolved_target_ref for local publication, got %v", publicationResult["resolved_target_ref"])
	}
}

func TestExecuteNodePublishesArtifactForConcreteTargetRef(t *testing.T) {
	operation := core.NewRecord(core.NewBaseCollection("app_operations"))
	operation.Set("project_dir", "/tmp/demo-app")
	operation.Set("spec_json", map[string]any{
		"source_build": map[string]any{
			"artifact_publication": map[string]any{
				"mode":       "push",
				"image_name": "apps/demo-app",
				"image_tag":  "candidate",
				"target_ref": "registry.example.com/apps/demo-app:candidate",
			},
			"build_result": map[string]any{
				"status":                 "local_image_built",
				"expected_artifact_kind": "oci-image",
				"local_image_ref":        "apps/demo-app:candidate",
			},
		},
	})

	result, err := ExecuteNode(context.Background(), operation, model.NodeDefinition{NodeType: "artifact_publish"}, publishExecutor{}, nil, NodeExecutionHooks{})
	if err != nil {
		t.Fatalf("expected concrete artifact_publish to succeed, got %v", err)
	}
	if !result.OperationChanged {
		t.Fatal("expected artifact_publish to mark operation as changed")
	}
	if result.DockerClient == nil {
		t.Fatal("expected artifact_publish to retain docker client after real publication path")
	}

	spec := operation.Get("spec_json").(map[string]any)
	sourceBuild := spec["source_build"].(map[string]any)
	publicationResult := sourceBuild["publication_result"].(map[string]any)
	if publicationResult["status"] != "published" {
		t.Fatalf("expected published status, got %v", publicationResult["status"])
	}
	if publicationResult["resolution_state"] != "resolved" {
		t.Fatalf("expected resolved resolution_state, got %v", publicationResult["resolution_state"])
	}
	if publicationResult["resolved_target_ref"] != "registry.example.com/apps/demo-app:candidate" {
		t.Fatalf("unexpected resolved_target_ref: %v", publicationResult["resolved_target_ref"])
	}
	if publicationResult["published_ref"] != "registry.example.com/apps/demo-app:candidate" {
		t.Fatalf("unexpected published_ref: %v", publicationResult["published_ref"])
	}
	if publicationResult["artifact_digest"] != "registry.example.com/apps/demo-app@sha256:abc123" {
		t.Fatalf("unexpected artifact_digest: %v", publicationResult["artifact_digest"])
	}
}

func TestExecuteNodeAllowsSourceBuildReleaseCandidatePlaceholder(t *testing.T) {
	operation := core.NewRecord(core.NewBaseCollection("app_operations"))
	operation.Set("project_dir", "/appos/data/apps/operations/demo")
	operation.Set("rendered_compose", "services:\n  web:\n    image: nginx:alpine\n")
	operation.Set("operation_type", string(model.OperationTypeInstall))

	for _, nodeType := range []string{"release_candidate"} {
		t.Run(nodeType, func(t *testing.T) {
			if _, err := ExecuteNode(context.Background(), operation, model.NodeDefinition{NodeType: nodeType}, noopExecutor{}, nil, NodeExecutionHooks{}); err != nil {
				t.Fatalf("expected %s placeholder to succeed, got %v", nodeType, err)
			}
		})
	}
}

func TestExecuteNodePullsRuntimeImages(t *testing.T) {
	operation := core.NewRecord(core.NewBaseCollection("app_operations"))
	operation.Set("project_dir", "/tmp/demo-app")
	operation.Set("rendered_compose", "services:\n  db:\n    image: postgres:16\n")

	var lines []string
	result, err := ExecuteNode(
		context.Background(),
		operation,
		model.NodeDefinition{NodeType: "runtime_pull"},
		runtimeExecutor{},
		nil,
		NodeExecutionHooks{Logf: func(line string) { lines = append(lines, line) }},
	)
	if err != nil {
		t.Fatalf("expected runtime_pull to succeed, got %v", err)
	}
	if result.DockerClient == nil {
		t.Fatal("expected runtime_pull to retain docker client")
	}
	if len(lines) != 5 {
		t.Fatalf("expected 5 runtime pull log lines, got %v", lines)
	}
	if !strings.Contains(lines[0], "docker runtime pull started: postgres:16") {
		t.Fatalf("expected first runtime pull log line, got %v", lines[0])
	}
	if !strings.Contains(lines[1], "docker runtime pull: Pulling postgres:16") {
		t.Fatalf("expected pull begin line, got %v", lines[1])
	}
	if !strings.Contains(lines[2], "docker runtime pull: Downloading layer sha256:123") {
		t.Fatalf("expected incremental layer download line, got %v", lines[1])
	}
	if !strings.Contains(lines[3], "docker runtime pull: Pull complete") {
		t.Fatalf("expected runtime pull log output, got %v", lines)
	}
	if !strings.Contains(lines[4], "docker runtime pull succeeded: postgres:16") {
		t.Fatalf("expected runtime pull success log line, got %v", lines[4])
	}
	if result.OperationChanged {
		t.Fatal("expected runtime_pull not to mutate operation state")
	}
}

func TestExecuteNodeSkipsRuntimePullWhenImagesAlreadyExistLocally(t *testing.T) {
	operation := core.NewRecord(core.NewBaseCollection("app_operations"))
	operation.Set("project_dir", "/tmp/demo-app")
	operation.Set("rendered_compose", "services:\n  db:\n    image: postgres:16\n")

	fakeExec := &runtimeLocalImageDockerExecutor{}
	var lines []string
	result, err := ExecuteNode(
		context.Background(),
		operation,
		model.NodeDefinition{NodeType: "runtime_pull"},
		runtimeLocalImageExecutor{exec: fakeExec},
		nil,
		NodeExecutionHooks{Logf: func(line string) { lines = append(lines, line) }},
	)
	if err != nil {
		t.Fatalf("expected runtime_pull to skip when image already exists locally, got %v", err)
	}
	if result.DockerClient == nil {
		t.Fatal("expected runtime_pull to retain docker client")
	}
	commands := strings.Join(fakeExec.commands, "\n")
	if !strings.Contains(commands, "docker image inspect postgres:16") {
		t.Fatalf("expected local image inspect, got commands:\n%s", commands)
	}
	if strings.Contains(commands, "docker pull postgres:16") {
		t.Fatalf("expected docker pull to be skipped when image exists locally, got commands:\n%s", commands)
	}
	joinedLines := strings.Join(lines, "\n")
	if !strings.Contains(joinedLines, "docker runtime image already available locally: postgres:16") {
		t.Fatalf("expected local image reuse log, got %v", lines)
	}
	if !strings.Contains(joinedLines, "docker runtime pull skipped because all runtime images are already available locally") {
		t.Fatalf("expected runtime pull skip log, got %v", lines)
	}
}

func TestExecuteNodeRuntimePullOnlyPullsMissingImages(t *testing.T) {
	operation := core.NewRecord(core.NewBaseCollection("app_operations"))
	operation.Set("project_dir", "/tmp/demo-app")
	operation.Set("rendered_compose", "services:\n  db:\n    image: postgres:16\n  web:\n    image: nginx:alpine\n")

	fakeExec := &mirrorAwareRuntimeDockerExecutor{available: map[string]bool{"nginx:alpine": true}}
	var lines []string
	_, err := ExecuteNode(
		context.Background(),
		operation,
		model.NodeDefinition{NodeType: "runtime_pull"},
		mirrorAwareRuntimeExecutor{exec: fakeExec},
		nil,
		NodeExecutionHooks{Logf: func(line string) { lines = append(lines, line) }},
	)
	if err != nil {
		t.Fatalf("expected runtime_pull to pull only missing images, got %v", err)
	}
	commands := strings.Join(fakeExec.commands, "\n")
	if strings.Contains(commands, "docker pull nginx:alpine") {
		t.Fatalf("expected existing nginx image not to be pulled again, got commands:\n%s", commands)
	}
	if !strings.Contains(commands, "docker pull postgres:16") {
		t.Fatalf("expected missing postgres image to be pulled, got commands:\n%s", commands)
	}
	joinedLines := strings.Join(lines, "\n")
	if !strings.Contains(joinedLines, "docker runtime image already available locally: nginx:alpine") {
		t.Fatalf("expected existing-image reuse log, got %v", lines)
	}
}

func TestExecuteNodeRuntimePullCreatesMissingExternalNetwork(t *testing.T) {
	operation := core.NewRecord(core.NewBaseCollection("app_operations"))
	operation.Set("project_dir", "/tmp/demo-app")
	operation.Set("rendered_compose", "services:\n  web:\n    image: nginx:alpine\nnetworks:\n  default:\n    name: websoft9\n    external: true\n")

	fakeExec := &runtimeNetworkDockerExecutor{}
	var lines []string
	_, err := ExecuteNode(
		context.Background(),
		operation,
		model.NodeDefinition{NodeType: "runtime_pull"},
		runtimeNetworkExecutor{exec: fakeExec},
		nil,
		NodeExecutionHooks{Logf: func(line string) { lines = append(lines, line) }},
	)
	if err != nil {
		t.Fatalf("expected runtime_pull to auto-create missing external network, got %v", err)
	}
	commands := strings.Join(fakeExec.commands, "\n")
	if !strings.Contains(commands, "docker network inspect websoft9") {
		t.Fatalf("expected network inspect before pull, got commands:\n%s", commands)
	}
	if !strings.Contains(commands, "docker network create websoft9") {
		t.Fatalf("expected missing external network to be created, got commands:\n%s", commands)
	}
	joinedLines := strings.Join(lines, "\n")
	if !strings.Contains(joinedLines, "docker external network missing, creating: websoft9") {
		t.Fatalf("expected creation log line, got %v", lines)
	}
	if !strings.Contains(joinedLines, "docker external network created: websoft9") {
		t.Fatalf("expected created log line, got %v", lines)
	}
}

func TestExecuteNodePullsRuntimeImagesViaConfiguredMirrors(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	if err := sysconfig.SetGroup(app, "docker", "mirror", map[string]any{
		"mirrors":                 []any{"https://mirror.example.com"},
		"allowInsecureRegistries": false,
	}); err != nil {
		t.Fatal(err)
	}

	operation := core.NewRecord(core.NewBaseCollection("app_operations"))
	operation.Set("project_dir", "/tmp/demo-app")
	operation.Set("rendered_compose", "services:\n  web:\n    image: nginx:alpine\n")

	fakeExec := &mirrorAwareRuntimeDockerExecutor{upstreamPullErr: errors.New("failed to resolve reference \"docker.io/library/nginx:alpine\": dial tcp 1.2.3.4:443: i/o timeout")}
	var lines []string
	result, err := ExecuteNode(
		context.Background(),
		operation,
		model.NodeDefinition{NodeType: "runtime_pull"},
		mirrorAwareRuntimeExecutor{app: app, exec: fakeExec},
		nil,
		NodeExecutionHooks{Logf: func(line string) { lines = append(lines, line) }},
	)
	if err != nil {
		t.Fatalf("expected mirror-aware runtime_pull to succeed, got %v", err)
	}
	if result.DockerClient == nil {
		t.Fatal("expected runtime_pull to retain docker client")
	}
	commands := strings.Join(fakeExec.commands, "\n")
	if !strings.Contains(commands, "docker pull nginx:alpine") {
		t.Fatalf("expected upstream pull attempt before mirror fallback, got commands:\n%s", commands)
	}
	if !strings.Contains(commands, "docker pull mirror.example.com/library/nginx:alpine") {
		t.Fatalf("expected mirror pull command, got commands:\n%s", commands)
	}
	if !strings.Contains(commands, "docker image tag mirror.example.com/library/nginx:alpine nginx:alpine") {
		t.Fatalf("expected mirror tag command, got commands:\n%s", commands)
	}
	joinedLines := strings.Join(lines, "\n")
	if !strings.Contains(joinedLines, "docker runtime upstream pull failed, switching to configured mirrors") {
		t.Fatalf("expected upstream fallback log, got %v", lines)
	}
	if !strings.Contains(joinedLines, "docker runtime mirror pull started: nginx:alpine via mirror.example.com/library/nginx:alpine") {
		t.Fatalf("expected mirror start log, got %v", lines)
	}
	if !strings.Contains(joinedLines, "docker runtime mirror pull succeeded: nginx:alpine via mirror.example.com/library/nginx:alpine") {
		t.Fatalf("expected mirror success log, got %v", lines)
	}
}

func TestExecuteNodeRetriesEachMirrorBeforeMovingOn(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	if err := sysconfig.SetGroup(app, "docker", "mirror", map[string]any{
		"mirrors":                 []any{"https://mirror-a.example.com", "https://mirror-b.example.com"},
		"allowInsecureRegistries": false,
	}); err != nil {
		t.Fatal(err)
	}

	operation := core.NewRecord(core.NewBaseCollection("app_operations"))
	operation.Set("project_dir", "/tmp/demo-app")
	operation.Set("rendered_compose", "services:\n  web:\n    image: nginx:alpine\n")

	fakeExec := &mirrorAwareRuntimeDockerExecutor{upstreamPullErr: errors.New("upstream timeout"), pullErrSeq: map[string][]error{
		"mirror-a.example.com/library/nginx:alpine": {errors.New("attempt1"), errors.New("attempt2"), errors.New("attempt3")},
		"mirror-b.example.com/library/nginx:alpine": {errors.New("attempt1"), errors.New("attempt2"), nil},
	}}
	var lines []string
	_, err = ExecuteNode(
		context.Background(),
		operation,
		model.NodeDefinition{NodeType: "runtime_pull"},
		mirrorAwareRuntimeExecutor{app: app, exec: fakeExec},
		nil,
		NodeExecutionHooks{Logf: func(line string) { lines = append(lines, line) }},
	)
	if err != nil {
		t.Fatalf("expected mirror-aware runtime_pull to succeed, got %v", err)
	}

	commands := strings.Join(fakeExec.commands, "\n")
	if strings.Count(commands, "docker pull nginx:alpine") != 1 {
		t.Fatalf("expected a single upstream pull attempt before mirror retries, got commands:\n%s", commands)
	}
	if strings.Count(commands, "docker pull mirror-a.example.com/library/nginx:alpine") != 3 {
		t.Fatalf("expected three attempts for mirror A, got commands:\n%s", commands)
	}
	if strings.Count(commands, "docker pull mirror-b.example.com/library/nginx:alpine") != 3 {
		t.Fatalf("expected three attempts for mirror B, got commands:\n%s", commands)
	}
	joinedLines := strings.Join(lines, "\n")
	if !strings.Contains(joinedLines, "docker runtime mirror pull retry 1/2 started: nginx:alpine via mirror-a.example.com/library/nginx:alpine") {
		t.Fatalf("expected retry log for mirror A, got %v", lines)
	}
	if !strings.Contains(joinedLines, "docker runtime mirror pull succeeded: nginx:alpine via mirror-b.example.com/library/nginx:alpine") {
		t.Fatalf("expected mirror B success log, got %v", lines)
	}
}

func TestExecuteNodeRejectsArtifactBuildWithoutHydratedWorkspace(t *testing.T) {
	projectDir := t.TempDir()
	operation := core.NewRecord(core.NewBaseCollection("app_operations"))
	operation.Set("project_dir", projectDir)
	operation.Set("spec_json", map[string]any{
		"source_build": map[string]any{
			"builder_strategy": "buildpacks",
		},
	})

	_, err := ExecuteNode(context.Background(), operation, model.NodeDefinition{NodeType: "artifact_build"}, noopExecutor{}, nil, NodeExecutionHooks{})
	if err == nil {
		t.Fatal("expected artifact_build to fail when source workspace is missing")
	}
	if !strings.Contains(err.Error(), filepath.Join(projectDir, "src")) {
		t.Fatalf("expected missing source workspace error, got %v", err)
	}
}
