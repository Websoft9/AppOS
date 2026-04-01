package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/deploy"
	"github.com/websoft9/appos/backend/infra/docker"
	"github.com/websoft9/appos/backend/infra/fileutil"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
)

var sourceWorkspaceBasePath = "/appos/data"
var sourceWorkspaceAllowedRoots = []string{"apps", "templates", "workflows"}

type HealthChecker func(ctx context.Context, client interface {
	Exec(context.Context, ...string) (string, error)
}, projectDir string) error

type NodeExecutionHooks struct {
	Logf        func(string)
	HealthCheck HealthChecker
}

type NodeExecutionResult struct {
	DockerClient     *docker.Client
	OperationChanged bool
}

func ExecuteNode(
	ctx context.Context,
	operation *core.Record,
	node model.NodeDefinition,
	executor Executor,
	dockerClient *docker.Client,
	hooks NodeExecutionHooks,
) (NodeExecutionResult, error) {
	if operation == nil {
		return NodeExecutionResult{}, fmt.Errorf("operation is required")
	}
	if executor == nil {
		return NodeExecutionResult{}, fmt.Errorf("executor is required")
	}

	logf := hooks.Logf
	if logf == nil {
		logf = func(string) {}
	}
	healthCheck := hooks.HealthCheck
	if healthCheck == nil {
		healthCheck = RunDeploymentHealthCheck
	}

	result := NodeExecutionResult{DockerClient: dockerClient}

	switch node.NodeType {
	case "validation":
		if err := deploy.ValidateManualCompose(operation.GetString("rendered_compose")); err != nil {
			return result, err
		}
		logf("compose validation passed")
		return result, nil
	case "workspace":
		if err := executor.PrepareWorkspace(operation.GetString("project_dir"), operation.GetString("rendered_compose")); err != nil {
			return result, err
		}
		logf(executor.Name() + " workspace prepared: " + operation.GetString("project_dir"))
		return result, nil
	case "runtime_config":
		if operation.Get("resolved_env_json") == nil {
			operation.Set("resolved_env_json", map[string]any{})
			result.OperationChanged = true
		}
		logf("runtime config rendered")
		return result, nil
	case "source_workspace":
		workspaceRef := operationSourceBuildString(operation, "workspace_ref")
		if strings.TrimSpace(workspaceRef) == "" {
			return result, fmt.Errorf("source_build.workspace_ref is required for source workspace hydration")
		}
		if executor.Name() != "local" {
			return result, fmt.Errorf("source workspace hydration for executor %q is not implemented yet", executor.Name())
		}
		sourceAbs, err := fileutil.ResolveSafePath(sourceWorkspaceBasePath, workspaceRef, sourceWorkspaceAllowedRoots)
		if err != nil {
			return result, fmt.Errorf("invalid source_build.workspace_ref: %w", err)
		}
		info, err := os.Stat(sourceAbs)
		if err != nil {
			return result, err
		}
		if !info.IsDir() {
			return result, fmt.Errorf("source_build.workspace_ref must resolve to a directory")
		}
		targetDir := filepath.Join(operation.GetString("project_dir"), "src")
		if err := fileutil.CopyDir(sourceAbs, targetDir); err != nil {
			return result, err
		}
		logf("source workspace hydrated: " + workspaceRef + " -> " + targetDir)
		return result, nil
	case "artifact_build":
		builderStrategy := operationSourceBuildString(operation, "builder_strategy")
		if builderStrategy == "" {
			return result, fmt.Errorf("source_build.builder_strategy is required for artifact build")
		}
		if builderStrategy != "buildpacks" {
			return result, fmt.Errorf("source_build.builder_strategy %q is not supported yet", builderStrategy)
		}
		sourceDir := filepath.Join(operation.GetString("project_dir"), "src")
		info, err := os.Stat(sourceDir)
		if err != nil {
			return result, err
		}
		if !info.IsDir() {
			return result, fmt.Errorf("source build workspace %q is not a directory", sourceDir)
		}
		client, err := ensureDockerClient(executor, dockerClient)
		if err != nil {
			return result, err
		}
		if client == nil {
			return result, fmt.Errorf("docker client is required for artifact build")
		}
		result.DockerClient = client
		imageName := operationSourceBuildNestedString(operation, "artifact_publication", "image_name")
		imageTag := operationSourceBuildNestedString(operation, "artifact_publication", "image_tag")
		localImageRef := placeholderArtifactDigest(imageName, imageTag)
		buildOutput, err := client.ImageBuild(ctx, localImageRef, sourceDir)
		if buildOutput != "" {
			logf("docker image build output:\n" + buildOutput)
		}
		if err != nil {
			return result, err
		}
		buildResult := map[string]any{
			"status":                 "local_image_built",
			"builder_strategy":       builderStrategy,
			"source_dir":             sourceDir,
			"publication_mode":       normalizedPublicationMode(operationSourceBuildNestedString(operation, "artifact_publication", "mode")),
			"image_name":             imageName,
			"image_tag":              normalizedImageTag(imageTag),
			"local_image_ref":        localImageRef,
			"local_image_id":         inspectLocalImageID(ctx, client, localImageRef),
			"target_ref":             operationSourceBuildNestedString(operation, "artifact_publication", "target_ref"),
			"expected_artifact_kind": operationSourceBuildNestedString(operation, "artifact_publication", "expected_artifact_kind"),
			"recorded_at":            time.Now().UTC().Format(time.RFC3339),
		}
		if buildResult["expected_artifact_kind"] == "" {
			buildResult["expected_artifact_kind"] = "oci-image"
		}
		changed, err := setOperationSourceBuildValue(operation, "build_result", buildResult)
		if err != nil {
			return result, err
		}
		result.OperationChanged = result.OperationChanged || changed
		logf("artifact build recorded local image: " + localImageRef)
		return result, nil
	case "artifact_publish":
		buildResult, ok := operationSourceBuildNestedMap(operation, "build_result")
		if !ok {
			return result, fmt.Errorf("source_build.build_result is required for artifact publication")
		}
		if strings.TrimSpace(stringMapValue(buildResult, "status")) == "" {
			return result, fmt.Errorf("source_build.build_result.status is required for artifact publication")
		}
		publication := map[string]any{
			"status":                 "ready_for_release_candidate",
			"publication_mode":       normalizedPublicationMode(operationSourceBuildNestedString(operation, "artifact_publication", "mode")),
			"target_ref":             operationSourceBuildNestedString(operation, "artifact_publication", "target_ref"),
			"image_name":             operationSourceBuildNestedString(operation, "artifact_publication", "image_name"),
			"image_tag":              operationSourceBuildNestedString(operation, "artifact_publication", "image_tag"),
			"expected_artifact_kind": stringMapValue(buildResult, "expected_artifact_kind"),
			"recorded_at":            time.Now().UTC().Format(time.RFC3339),
		}
		if strings.TrimSpace(stringMapValue(publication, "image_tag")) == "" {
			publication["image_tag"] = "candidate"
		}
		if publication["expected_artifact_kind"] == "" {
			publication["expected_artifact_kind"] = "oci-image"
		}
		publication["artifact_digest"] = localArtifactRef(buildResult, publication)
		publication["local_image_ref"] = stringMapValue(publication, "artifact_digest")
		if strings.EqualFold(stringMapValue(publication, "publication_mode"), "local") {
			publication["status"] = "local_available"
		}
		resolvedTargetRef, resolutionState, resolutionMessage := resolvePublicationTargetRef(stringMapValue(publication, "target_ref"))
		if resolvedTargetRef != "" {
			publication["resolved_target_ref"] = resolvedTargetRef
		}
		if resolutionState != "" {
			publication["resolution_state"] = resolutionState
		}
		if resolutionMessage != "" {
			publication["resolution_message"] = resolutionMessage
		}

		if strings.EqualFold(stringMapValue(publication, "publication_mode"), "push") {
			if resolvedTargetRef != "" {
				client, err := ensureDockerClient(executor, dockerClient)
				if err != nil {
					return result, err
				}
				if client == nil {
					return result, fmt.Errorf("docker client is required for artifact publication")
				}
				result.DockerClient = client
				sourceRef := localArtifactRef(buildResult, publication)
				if _, err := client.ImageTag(ctx, sourceRef, resolvedTargetRef); err != nil {
					return result, err
				}
				logf("artifact tagged for publication: " + sourceRef + " -> " + resolvedTargetRef)
				pushOutput, err := client.ImagePush(ctx, resolvedTargetRef)
				if pushOutput != "" {
					logf("docker image push output:\n" + pushOutput)
				}
				if err != nil {
					return result, err
				}
				if digest := inspectArtifactDigest(ctx, client, resolvedTargetRef); digest != "" {
					publication["artifact_digest"] = digest
				}
				publication["published_ref"] = resolvedTargetRef
				publication["status"] = "published"
			} else if resolutionMessage != "" {
				logf("artifact publication target unresolved: " + resolutionMessage)
			}
		}
		changed, err := setOperationSourceBuildValue(operation, "publication_result", publication)
		if err != nil {
			return result, err
		}
		result.OperationChanged = result.OperationChanged || changed
		logf("artifact publication placeholder recorded for image: " + stringMapValue(publication, "image_name"))
		return result, nil
	case "release_candidate":
		return result, fmt.Errorf("source build node %q is not implemented yet", node.NodeType)
	case "runtime_start":
		client, err := ensureDockerClient(executor, dockerClient)
		if err != nil {
			return result, err
		}
		result.DockerClient = client
		var output string
		if strings.TrimSpace(operation.GetString("operation_type")) == string(model.OperationTypeStart) {
			output, err = client.ComposeStart(ctx, operation.GetString("project_dir"))
		} else {
			output, err = client.ComposeUp(ctx, operation.GetString("project_dir"))
		}
		if output != "" {
			logf("docker runtime start output:\n" + output)
		}
		if err != nil {
			return result, err
		}
		return result, nil
	case "runtime_stop":
		client, err := ensureDockerClient(executor, dockerClient)
		if err != nil {
			return result, err
		}
		result.DockerClient = client
		output, err := client.ComposeStop(ctx, operation.GetString("project_dir"))
		if output != "" {
			logf("docker compose stop output:\n" + output)
		}
		if err != nil {
			return result, err
		}
		return result, nil
	case "runtime_restart":
		client, err := ensureDockerClient(executor, dockerClient)
		if err != nil {
			return result, err
		}
		result.DockerClient = client
		output, err := client.ComposeRestart(ctx, operation.GetString("project_dir"))
		if output != "" {
			logf("docker compose restart output:\n" + output)
		}
		if err != nil {
			return result, err
		}
		return result, nil
	case "runtime_check":
		client, err := ensureDockerClient(executor, dockerClient)
		if err != nil {
			return result, err
		}
		result.DockerClient = client
		composeFile := operation.GetString("project_dir") + "/docker-compose.yml"
		output, err := client.Exec(ctx, "compose", "-f", composeFile, "ps", "--status", "running", "-q")
		if err != nil {
			return result, err
		}
		if strings.TrimSpace(output) != "" {
			return result, fmt.Errorf("runtime still reports running services")
		}
		logf("runtime check passed")
		return result, nil
	case "retirement":
		client, err := ensureDockerClient(executor, dockerClient)
		if err != nil {
			return result, err
		}
		result.DockerClient = client
		removeVolumes := operationMetadataBool(operation, "remove_volumes")
		output, err := client.ComposeDown(ctx, operation.GetString("project_dir"), removeVolumes)
		if output != "" {
			logf("docker compose down output:\n" + output)
		}
		if err != nil {
			return result, err
		}
		return result, nil
	case "health_check":
		client, err := ensureDockerClient(executor, dockerClient)
		if err != nil {
			return result, err
		}
		result.DockerClient = client
		healthCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		defer cancel()
		if err := healthCheck(healthCtx, client, operation.GetString("project_dir")); err != nil {
			return result, err
		}
		logf("health check passed")
		return result, nil
	default:
		logf("skipped unsupported node type: " + node.NodeType)
		return result, nil
	}
}

func operationMetadataBool(operation *core.Record, key string) bool {
	if operation == nil || strings.TrimSpace(key) == "" {
		return false
	}
	raw := operation.Get("spec_json")
	spec, ok := raw.(map[string]any)
	if !ok {
		encoded, err := json.Marshal(raw)
		if err != nil {
			return false
		}
		if err := json.Unmarshal(encoded, &spec); err != nil {
			return false
		}
	}
	metadata, ok := spec["metadata"].(map[string]any)
	if !ok {
		return false
	}
	value, ok := metadata[key]
	if !ok {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(strings.TrimSpace(typed), "true") || strings.TrimSpace(typed) == "1"
	default:
		return false
	}
}

func operationSourceBuildString(operation *core.Record, key string) string {
	value, ok := operationSourceBuildValue(operation, key)
	if !ok {
		return ""
	}
	stringValue, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(stringValue)
}

func operationSourceBuildNestedString(operation *core.Record, parentKey, key string) string {
	if operation == nil || strings.TrimSpace(parentKey) == "" || strings.TrimSpace(key) == "" {
		return ""
	}
	parent, ok := operationSourceBuildValue(operation, parentKey)
	if !ok {
		return ""
	}
	parentMap, ok := parent.(map[string]any)
	if !ok {
		return ""
	}
	value, ok := parentMap[key]
	if !ok {
		return ""
	}
	stringValue, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(stringValue)
}

func operationSourceBuildNestedMap(operation *core.Record, key string) (map[string]any, bool) {
	value, ok := operationSourceBuildValue(operation, key)
	if !ok {
		return nil, false
	}
	direct, ok := value.(map[string]any)
	if ok {
		return direct, true
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, false
	}
	var parsed map[string]any
	if err := json.Unmarshal(encoded, &parsed); err != nil {
		return nil, false
	}
	return parsed, true
}

func operationSourceBuildValue(operation *core.Record, key string) (any, bool) {
	if operation == nil || strings.TrimSpace(key) == "" {
		return nil, false
	}
	spec, ok := operationSpecMap(operation)
	if !ok {
		return nil, false
	}
	sourceBuild, ok := spec["source_build"].(map[string]any)
	if !ok {
		return nil, false
	}
	value, ok := sourceBuild[key]
	if !ok {
		return nil, false
	}
	return value, true
}

func setOperationSourceBuildValue(operation *core.Record, key string, value any) (bool, error) {
	if operation == nil || strings.TrimSpace(key) == "" {
		return false, fmt.Errorf("operation and key are required")
	}
	spec, ok := operationSpecMap(operation)
	if !ok {
		return false, fmt.Errorf("operation spec_json is invalid")
	}
	sourceBuild, ok := spec["source_build"].(map[string]any)
	if !ok {
		return false, fmt.Errorf("operation spec_json.source_build is invalid")
	}
	sourceBuild[key] = value
	spec["source_build"] = sourceBuild
	operation.Set("spec_json", spec)
	return true, nil
}

func operationSpecMap(operation *core.Record) (map[string]any, bool) {
	if operation == nil {
		return nil, false
	}
	raw := operation.Get("spec_json")
	spec, ok := raw.(map[string]any)
	if ok {
		return spec, true
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return nil, false
	}
	if err := json.Unmarshal(encoded, &spec); err != nil {
		return nil, false
	}
	return spec, true
}

func stringMapValue(values map[string]any, key string) string {
	if len(values) == 0 || strings.TrimSpace(key) == "" {
		return ""
	}
	value, ok := values[key]
	if !ok {
		return ""
	}
	stringValue, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(stringValue)
}

func placeholderArtifactDigest(imageName, imageTag string) string {
	imageName = strings.TrimSpace(imageName)
	if imageName == "" {
		return ""
	}
	imageTag = strings.TrimSpace(imageTag)
	if imageTag == "" {
		imageTag = "candidate"
	}
	return imageName + ":" + imageTag
}

func normalizedImageTag(imageTag string) string {
	trimmed := strings.TrimSpace(imageTag)
	if trimmed == "" {
		return "candidate"
	}
	return trimmed
}

func localArtifactRef(buildResult map[string]any, publication map[string]any) string {
	if localImageRef := stringMapValue(buildResult, "local_image_ref"); localImageRef != "" {
		return localImageRef
	}
	return placeholderArtifactDigest(stringMapValue(publication, "image_name"), stringMapValue(publication, "image_tag"))
}

func normalizedPublicationMode(mode string) string {
	trimmed := strings.TrimSpace(mode)
	if trimmed == "" {
		return "local"
	}
	return trimmed
}

func isConcreteImageReference(ref string) bool {
	trimmed := strings.TrimSpace(ref)
	if trimmed == "" {
		return false
	}
	return !strings.Contains(trimmed, "://")
}

func resolvePublicationTargetRef(targetRef string) (resolvedRef, resolutionState, resolutionMessage string) {
	trimmed := strings.TrimSpace(targetRef)
	if trimmed == "" {
		return "", "", ""
	}
	if isConcreteImageReference(trimmed) {
		return trimmed, "resolved", ""
	}
	if strings.HasPrefix(trimmed, "registry://default/") {
		return "", "unresolved", "default registry target is symbolic and no concrete registry resolver is configured"
	}
	return "", "unresolved", "artifact publication target is symbolic and cannot be pushed without resolution"
}

func inspectArtifactDigest(ctx context.Context, client *docker.Client, ref string) string {
	if client == nil || strings.TrimSpace(ref) == "" {
		return ""
	}
	output, err := client.ImageInspect(ctx, ref)
	if err != nil {
		return ""
	}
	var records []struct {
		RepoDigests []string `json:"RepoDigests"`
	}
	if err := json.Unmarshal([]byte(output), &records); err != nil {
		return ""
	}
	for _, record := range records {
		for _, digest := range record.RepoDigests {
			if strings.TrimSpace(digest) != "" {
				return strings.TrimSpace(digest)
			}
		}
	}
	return ""
}

func inspectLocalImageID(ctx context.Context, client *docker.Client, ref string) string {
	if client == nil || strings.TrimSpace(ref) == "" {
		return ""
	}
	output, err := client.ImageInspect(ctx, ref)
	if err != nil {
		return ""
	}
	var records []struct {
		ID string `json:"Id"`
	}
	if err := json.Unmarshal([]byte(output), &records); err != nil {
		return ""
	}
	for _, record := range records {
		if strings.TrimSpace(record.ID) != "" {
			return strings.TrimSpace(record.ID)
		}
	}
	return ""
}

func ensureDockerClient(executor Executor, current *docker.Client) (*docker.Client, error) {
	if current != nil {
		return current, nil
	}
	return executor.DockerClient()
}

func RunDeploymentHealthCheck(ctx context.Context, client interface {
	Exec(context.Context, ...string) (string, error)
}, projectDir string) error {
	composeFile := projectDir + "/docker-compose.yml"
	var lastErr error
	for attempt := 0; attempt < 5; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		attemptCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		output, err := client.Exec(attemptCtx, "compose", "-f", composeFile, "ps", "--status", "running", "-q")
		cancel()
		if err == nil && strings.TrimSpace(output) != "" {
			return nil
		}
		if err != nil {
			lastErr = err
		} else {
			lastErr = fmt.Errorf("no running services reported")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
	return lastErr
}
