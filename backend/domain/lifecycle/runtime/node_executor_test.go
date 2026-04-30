package runtime

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
	"github.com/websoft9/appos/backend/infra/docker"
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

func TestExecuteNodeRejectsUnimplementedSourceBuildNodeTypes(t *testing.T) {
	operation := core.NewRecord(core.NewBaseCollection("app_operations"))
	operation.Set("project_dir", "/appos/data/apps/operations/demo")
	operation.Set("rendered_compose", "services:\n  web:\n    image: nginx:alpine\n")
	operation.Set("operation_type", string(model.OperationTypeInstall))

	for _, nodeType := range []string{"release_candidate"} {
		t.Run(nodeType, func(t *testing.T) {
			_, err := ExecuteNode(context.Background(), operation, model.NodeDefinition{NodeType: nodeType}, noopExecutor{}, nil, NodeExecutionHooks{})
			if err == nil {
				t.Fatalf("expected %s to fail fast", nodeType)
			}
			if !strings.Contains(err.Error(), "not implemented yet") {
				t.Fatalf("expected not implemented error for %s, got %v", nodeType, err)
			}
		})
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
